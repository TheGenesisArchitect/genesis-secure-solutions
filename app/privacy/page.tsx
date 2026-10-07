import { LegalPage } from '@/components/LegalPage';
import { privacy } from '@/data/legal-texts';

export const metadata = { title: 'Privacy' };

export default function Page() {
  return <LegalPage text={privacy} />;
}
