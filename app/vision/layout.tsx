import './vision.css';
import { HelixTour } from '@/components/vision/HelixTour';

// The tour lives in the layout so Helix's voice session continues as it moves between chapters.
export default function VisionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <HelixTour />
    </>
  );
}
