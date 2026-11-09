# Видео «Это сделал Claude без After Effects»

Вертикальное 1080×1920, 30 fps, 30 с. Графика и субтитры рендерятся кодом (Remotion), без озвучки (только музыка).

- Рендер: `npx remotion render src/index.ts Main out/video.mp4`
- Тайминги субтитров и сцен: `src/timeline.ts`
- Наложить озвучку: `scripts/add_voice.sh voice.wav out/video.mp4 out/final.mp4` (музыка автоматически приглушается под голос)
- Если озвучка по длительности/паузам другая: подправить `src/timeline.ts`, при желании пересчитать волну `python3 scripts/make_audio.py voice.wav`, перерендерить
