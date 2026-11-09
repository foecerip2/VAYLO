import React from "react";
import { Composition } from "remotion";
import { Main, TOTAL_FRAMES } from "./Video";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Main"
    component={Main}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1080}
    height={1920}
  />
);
