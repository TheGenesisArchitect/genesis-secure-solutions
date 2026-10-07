import { LegalPage } from '@/components/LegalPage';
import { dataDeletion } from '@/data/legal-texts';

export const metadata = { title: 'Data deletion' };

export default function Page() {
  return <LegalPage text={dataDeletion} />;
}
