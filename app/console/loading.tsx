import { LoadingFrame } from '@/components/LoadingFrame';
import { consoleNav } from '@/components/ConsoleShell';

export default function Loading() {
  return <LoadingFrame surface="Enterprise" home="/console" nav={consoleNav(null)} />;
}
