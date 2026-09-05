# HomeoRemedica dataset

This directory contains the source corpus used by the HomeoRemedica retrieval pipeline.

| Corpus ID | Historical author and work | Raw source | Processed source |
| --- | --- | --- | --- |
| `allen-nosodes` | Henry Clay Allen, *The Materia Medica of the Nosodes* | `raw-text/allen-nosodes.txt` | `processed/allen-nosodes.json` |
| `boericke-MM` | William Boericke, *Homoeopathic Materia Medica* | `raw-text/Boericke.txt` | `processed/boericke-MM.json` |
| `clarke-MM` | John Henry Clarke, *A Dictionary of Practical Materia Medica* | `raw-text/clarke-vol1.txt`, `raw-text/clarke-vol2.txt` | `processed/clarke-MM.json` |
| `kent-lectures` | James Tyler Kent, *Lectures on Homoeopathic Materia Medica* | `raw-text/Kent-lectures.txt` | `processed/kent-lectures.json` |

Processed files use the `remedy -> section -> passages` JSON structure. The four per-book files are
merged losslessly into `combined.json`, a remedy-merged
`remedy -> book -> section -> passages` structure with 1,250 unique remedies over 1,645
remedy-book pairs, 18,183 sections, and 118,259 passages. The retrieval pipeline reads
`combined.json` as its corpus source; run
`uv run --locked homeoremedica-corpus validate` from the repository root to validate it and
reproduce its counts and digest.

## License and attribution

The dataset compilation and processing contributions are licensed under
[CC BY 4.0](LICENSE.md). When attribution is required, credit the “HomeoRemedica Dataset” to
Rasagya Vatsal, link the project and license where reasonably practicable, and indicate changes.

The historical source works are not authored by Rasagya Vatsal. Public-domain material remains
public domain, and source-specific notices or third-party rights remain applicable. See the full
dataset license notice before reuse.
