import { LoadingFrame } from '@/components/LoadingFrame';

// The agency's rail depends on its program, so the instant frame shows a quiet rail and the page fills both in.
export default function Loading() {
  return <LoadingFrame surface="Agency" home="/app" nav={[]} />;
}
