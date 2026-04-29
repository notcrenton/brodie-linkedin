'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const VoiceDraftComponent: FC = () => {
  const fetch = useFetch();
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generate = useCallback(async () => {
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError(null);
    setVariants([]);
    try {
      const res = await fetch('/voice-draft', {
        method: 'POST',
        body: JSON.stringify({ topic }),
      });
      if (!res.ok) {
        setError(`Generation failed (${res.status})`);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { variants: string[] };
      setVariants(data.variants || []);
    } catch (e) {
      setError((e as Error)?.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [fetch, topic, loading]);

  const copy = useCallback(async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="flex flex-col gap-[24px] p-[32px] max-w-[1100px] mx-auto">
      <div className="flex flex-col gap-[8px]">
        <h1 className="text-[28px] font-[600]">Voice Drafter</h1>
        <p className="text-[14px] opacity-70 leading-[1.5]">
          Drops a topic into the Brodie voice library (4 hand-picked top
          performers + voice patterns) and returns 5 variants in your voice.
          Pick one, copy it, and post it from the calendar.
        </p>
      </div>

      <div className="flex flex-col gap-[12px]">
        <label className="text-[14px] font-[500]" htmlFor="voice-topic">
          Topic
        </label>
        <textarea
          id="voice-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Brodie Wrapped — tonight we send Spotify-Wrapped-style season recaps to 35,000+ players in 20+ cities, with their game highs, championships, badges, and photos from every game."
          rows={5}
          className="w-full p-[14px] rounded-[6px] bg-[var(--new-bgColorInner)] border border-[var(--new-border)] text-[14px] leading-[1.5] focus:outline-none focus:border-[var(--new-btn-primary)]"
        />
        <div className="flex items-center gap-[12px]">
          <button
            type="button"
            onClick={generate}
            disabled={!topic.trim() || loading}
            className="px-[20px] py-[10px] rounded-[6px] bg-[var(--new-btn-primary)] text-[var(--new-btn-text)] font-[500] text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Generating in your voice…' : 'Generate 5 variants'}
          </button>
          {error ? (
            <span className="text-[13px] text-red-400">{error}</span>
          ) : null}
        </div>
      </div>

      {variants.length > 0 && (
        <div className="flex flex-col gap-[16px]">
          <h2 className="text-[18px] font-[600] mt-[8px]">
            Variants ({variants.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
            {variants.map((v, i) => (
              <div
                key={i}
                className="rounded-[8px] border border-[var(--new-border)] bg-[var(--new-bgColorInner)] p-[16px] flex flex-col gap-[12px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] uppercase tracking-wide opacity-60">
                    Variant {i + 1}
                  </span>
                  <span className="text-[12px] opacity-60">
                    {v.length} chars
                  </span>
                </div>
                <pre className="text-[13px] leading-[1.55] whitespace-pre-wrap font-sans">
                  {v}
                </pre>
                <div className="flex gap-[8px]">
                  <button
                    type="button"
                    onClick={() => copy(v, i)}
                    className="px-[12px] py-[6px] rounded-[6px] bg-[var(--new-btn-simple)] text-[var(--new-btn-text)] text-[12px]"
                  >
                    {copiedIdx === i ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
