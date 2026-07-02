import { useEffect, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

/** Strip markdown/citation noise so the spoken text sounds natural. */
function toSpeakable(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\?\[(\d+)\\?\]/g, '') // citation refs like [1]
    .replace(/[#*_>~]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read-aloud for a block of text using the browser's SpeechSynthesis.
 * Only one utterance plays at a time across the whole app.
 */
export function useSpeech(text) {
  const [speaking, setSpeaking] = useState(false);
  const supported = !!synth;

  useEffect(() => {
    // Stop narration if this component unmounts mid-sentence.
    return () => {
      if (speaking && synth) synth.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (!synth) return;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const speakable = toSpeakable(text);
    if (!speakable) return;
    synth.cancel(); // stop anything already playing elsewhere
    const utter = new SpeechSynthesisUtterance(speakable);
    utter.rate = 1.02;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utter);
  };

  return { speaking, toggle, supported };
}
