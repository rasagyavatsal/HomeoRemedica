from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from google.api_core.exceptions import Conflict, NotFound, PreconditionFailed
from google.cloud import storage


class PublicationConflict(RuntimeError):
    """Raised when a create-only or generation-match precondition fails."""


@dataclass(frozen=True, slots=True)
class ObjectRef:
    name: str
    generation: int
    byte_size: int
    sha256: str


class ObjectStore(Protocol):
    def snapshot(self, name: str) -> ObjectRef | None: ...

    def create_file(self, name: str, path: Path) -> ObjectRef: ...

    def create_bytes(self, name: str, contents: bytes) -> ObjectRef: ...

    def replace_bytes(
        self, name: str, contents: bytes, *, if_generation_match: int
    ) -> ObjectRef: ...

    def read_bytes(self, name: str, generation: int) -> bytes: ...

    def verify(self, reference: ObjectRef, *, byte_size: int, sha256: str) -> None: ...


class GoogleCloudObjectStore:
    """Cloud Storage operations with immutable uploads and generation fencing."""

    def __init__(
        self,
        bucket_name: str,
        *,
        client: storage.Client | None = None,
    ) -> None:
        self._client = client or storage.Client()
        self._bucket = self._client.bucket(bucket_name)

    def snapshot(self, name: str) -> ObjectRef | None:
        blob = self._bucket.blob(name)
        try:
            blob.reload()
        except NotFound:
            return None
        return self._reference(blob)

    def create_file(self, name: str, path: Path) -> ObjectRef:
        digest = _sha256_file(path)
        blob = self._bucket.blob(name)
        blob.metadata = {"sha256": digest}
        try:
            blob.upload_from_filename(
                str(path),
                content_type="application/vnd.sqlite3",
                if_generation_match=0,
                checksum="auto",
            )
        except (Conflict, PreconditionFailed) as error:
            raise PublicationConflict(f"create-only upload failed for {name}") from error
        blob.reload()
        return self._reference(blob, known_sha256=digest)

    def create_bytes(self, name: str, contents: bytes) -> ObjectRef:
        return self._upload_bytes(name, contents, if_generation_match=0)

    def replace_bytes(self, name: str, contents: bytes, *, if_generation_match: int) -> ObjectRef:
        return self._upload_bytes(name, contents, if_generation_match=if_generation_match)

    def read_bytes(self, name: str, generation: int) -> bytes:
        blob = self._bucket.blob(name, generation=generation)
        try:
            return blob.download_as_bytes(if_generation_match=generation, checksum="auto")
        except (NotFound, PreconditionFailed) as error:
            raise PublicationConflict(
                f"object generation is unavailable: {name}#{generation}"
            ) from error

    def verify(self, reference: ObjectRef, *, byte_size: int, sha256: str) -> None:
        blob = self._bucket.blob(reference.name, generation=reference.generation)
        with tempfile.NamedTemporaryFile(prefix="corpus-object-", delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            blob.download_to_filename(
                str(temporary_path),
                if_generation_match=reference.generation,
                checksum="auto",
            )
            actual_size = temporary_path.stat().st_size
            actual_sha256 = _sha256_file(temporary_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        if actual_size != byte_size or actual_sha256 != sha256:
            raise RuntimeError(
                f"digest verification failed for {reference.name}#{reference.generation}"
            )

    def _upload_bytes(self, name: str, contents: bytes, *, if_generation_match: int) -> ObjectRef:
        digest = hashlib.sha256(contents).hexdigest()
        blob = self._bucket.blob(name)
        blob.metadata = {"sha256": digest}
        try:
            blob.upload_from_string(
                contents,
                content_type="application/json",
                if_generation_match=if_generation_match,
                checksum="auto",
            )
        except (Conflict, PreconditionFailed) as error:
            raise PublicationConflict(
                f"generation precondition failed for {name} at {if_generation_match}"
            ) from error
        blob.reload()
        return self._reference(blob, known_sha256=digest)

    def _reference(self, blob: storage.Blob, *, known_sha256: str | None = None) -> ObjectRef:
        name = blob.name
        if not isinstance(name, str) or blob.generation is None or blob.size is None:
            raise RuntimeError(f"Cloud Storage returned incomplete metadata for {blob.name}")
        digest = known_sha256 or (blob.metadata or {}).get("sha256")
        if digest is None:
            contents = blob.download_as_bytes(if_generation_match=int(blob.generation))
            digest = hashlib.sha256(contents).hexdigest()
        return ObjectRef(
            name=name,
            generation=int(blob.generation),
            byte_size=int(blob.size),
            sha256=digest,
        )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
