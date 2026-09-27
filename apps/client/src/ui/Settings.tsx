// Settings: master volume and mute, on the audio.ts API (both are
// remembered). Read when the panel opens; M can't toggle mute meanwhile (the
// game's keys are off while a panel is up), so nothing goes stale.

import { Switch } from "@astryxdesign/core/Switch";
import { Slider } from "@astryxdesign/core/Slider";
import { VStack } from "@astryxdesign/core/Layout";
import { useState } from "react";
import { getMasterVolume, isMuted, setMasterVolume, setMuted } from "../audio.ts";

export function Settings() {
  const [volume, setVolume] = useState(() => Math.round(getMasterVolume() * 100));
  const [muted, setMutedState] = useState(isMuted);

  const onVolume = (v: number) => {
    setVolume(v);
    setMasterVolume(v / 100);
    // Turning the volume up is a clear wish to hear something.
    if (isMuted() && v > 0) {
      setMuted(false);
      setMutedState(false);
    }
  };
  const onMute = (m: boolean) => {
    setMuted(m);
    setMutedState(m);
  };

  return (
    <VStack gap={6} data-testid="settings">
      <Slider
        label="Master volume"
        min={0}
        max={100}
        step={5}
        value={volume}
        onChange={onVolume}
        valueDisplay="text"
        formatValue={(v) => `${v}%`}
        isDisabled={false}
        data-testid="settings-volume"
      />
      <Switch
        label="Mute all sound"
        description="In a match, M toggles it too."
        value={muted}
        onChange={onMute}
        labelPosition="start"
        labelSpacing="spread"
        data-testid="settings-mute"
      />
    </VStack>
  );
}
