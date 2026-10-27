// "Invite them to pick a consultation time" (staff): who it's for, their emails, the length. Sending is outward, so
// it's a person's tap; Helix can fill it.
import { ActionForm } from '@/components/ActionForm';
import { sendConsultLink } from '@/lib/consult-send';

export function ConsultInviteForm({ label, emails, prospectId }: { label: string; emails: string; prospectId?: string }) {
  return (
    <ActionForm action={sendConsultLink} helix="consultation link" helixTitle="Invite to pick a consultation time" lane="outward" className="form" resetOnOk>
      {prospectId ? <input type="hidden" name="prospect" value={prospectId} /> : null}
      <label className="field"><span>Who it’s for</span><input className="input" name="label" required maxLength={120} defaultValue={label} /></label>
      <label className="field"><span>Their emails (everyone gets the invite)</span><input className="input" name="emails" required maxLength={600} defaultValue={emails} placeholder="name@agency.com, partner@agency.com" /></label>
      <label className="field"><span>Length</span>
        <select className="select" name="minutes" defaultValue="60"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select>
      </label>
      <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Send the pick-a-time link</button>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>They see your open times on the Genovus calendar (weekdays 9 to 5 Eastern) and pick one; the invite goes to everyone and it lands on your calendar.</p>
    </ActionForm>
  );
}
