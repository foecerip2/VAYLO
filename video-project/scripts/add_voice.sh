#!/usr/bin/env bash
# Lays a voice-over on the rendered video. The music is ducked under the voice automatically.
# usage: scripts/add_voice.sh voice.(wav|mp3|m4a) [video.mp4] [out.mp4]
set -euo pipefail
VOICE="${1:?voice file}"
VIDEO="${2:-out/video.mp4}"
OUT="${3:-out/video_with_voice.mp4}"
ffmpeg -y -v error -i "$VIDEO" -i "$VOICE" -filter_complex \
  "[0:a]volume=1.0[m];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,apad,asplit=2[v][sc];\
[m]aformat=sample_rates=48000:channel_layouts=stereo[ms];\
[ms][sc]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=300[duck];\
[duck][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")" "$OUT"
echo "wrote $OUT"
