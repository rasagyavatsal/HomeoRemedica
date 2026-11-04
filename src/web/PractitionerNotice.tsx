import { useState } from 'react'

import { Dialog } from './Dialog.tsx'
import { LegalLinks } from './Legal.tsx'

export const NOTICE_KEY = 'homeoremedica.practitioner-notice'

function acknowledged(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) !== null
  } catch {
    return false
  }
}

/** Who the app is for, shown until this browser has acknowledged it. */
export function PractitionerNotice() {
  const [open, setOpen] = useState(() => !acknowledged())
  if (!open) return null

  const acknowledge = () => {
    try {
      localStorage.setItem(NOTICE_KEY, new Date().toISOString())
    } catch {
      // Not remembering only costs the notice showing again on the next visit.
    }
    setOpen(false)
  }

  return (
    <Dialog title="For homeopathy practitioners" onClose={acknowledge}>
      <p>
        HomeoRemedica is a reference tool for qualified homeopathy doctors. It is not intended for patients or
        self-treatment.
      </p>
      <p>
        Do not enter patients’ personal details, such as names, contact details, ID numbers or anything else that
        identifies them. Describe symptoms and cases in general terms.
      </p>
      <p>
        By using HomeoRemedica, you agree to the <LegalLinks />.
      </p>
      <div className="dialog-actions">
        <button type="button" className="button button-primary" onClick={acknowledge} data-autofocus>
          I understand
        </button>
      </div>
    </Dialog>
  )
}
