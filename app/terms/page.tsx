import { LegalPage } from '@/components/LegalPage';
import { terms } from '@/data/legal-texts';

export const metadata = { title: 'Terms' };

export default function Page() {
  return <LegalPage text={terms} />;
}
