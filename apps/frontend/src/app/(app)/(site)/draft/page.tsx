export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { VoiceDraftComponent } from '@gitroom/frontend/components/draft/voice.draft.component';

export const metadata: Metadata = {
  title: 'Brodie LinkedIn — Voice Drafter',
  description: "Generate LinkedIn posts in Connor's voice using the Brodie voice library.",
};

export default function DraftPage() {
  return <VoiceDraftComponent />;
}
