const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

const ASSETS_DIR = path.join(__dirname, "..", "public");
const CIRCLE_MASK = path.join(ASSETS_DIR, "circle-mask.png");
const BADGES = {
  blue: path.join(ASSETS_DIR, "badge-blue.png"),
  gold: path.join(ASSETS_DIR, "badge-gold.png"),
  silver: path.join(ASSETS_DIR, "badge-silver.png"),
};

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const CW = 1080;
const CH = 1920;

const BG_COLORS = { black: "black", white: "white", dim: "0x15202b" };

const WM_POSITIONS = {
  "top-left": "40:40",
  "top-right": "W-w-40:40",
  "bottom-left": "40:H-h-40",
  "bottom-right": "W-w-40:H-h-40",
  center: "(W-w)/2:(H-h)/2",
};

function escText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

function wrapLines(text, maxWidth, fontSize) {
  const approxChar = fontSize * 0.56;
  const maxChars = Math.max(6, Math.floor(maxWidth / approxChar));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (test.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function getRotationDegrees(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return resolve(0);
      const stream = (data.streams || []).find((s) => s.codec_type === "video");
      if (!stream) return resolve(0);
      let rotation = 0;
      if (stream.tags && stream.tags.rotate) {
        rotation = parseInt(stream.tags.rotate, 10) || 0;
      }
      if (Array.isArray(stream.side_data_list)) {
        const dm = stream.side_data_list.find((sd) => typeof sd.rotation === "number");
        if (dm) rotation = Math.round(dm.rotation);
      }
      rotation = ((rotation % 360) + 360) % 360;
      resolve(rotation);
    });
  });
}

async function processVideo({ inputVideo, logoPath, watermarkPath, template, outputPath, onProgress }) {
  const rotation = await getRotationDegrees(inputVideo);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputVideo).inputOptions(["-threads", "1"]);

    let nextInputIndex = 1;
    const hasAvatar = !!logoPath;
    const isVerified = !!template.verified;
    const badgePath = isVerified ? BADGES[template.verifiedColor] || BADGES.blue : null;
    const hasWatermark = !!(template.watermark && template.watermark.enabled && watermarkPath);

    let logoIdx = null;
    let maskIdx = null;
    let badgeIdx = null;
    let wmIdx = null;

    if (hasAvatar) {
      cmd.input(logoPath);
      logoIdx = nextInputIndex++;
      cmd.input(CIRCLE_MASK);
      maskIdx = nextInputIndex++;
    }
    if (badgePath) {
      cmd.input(badgePath);
      badgeIdx = nextInputIndex++;
    }
    if (hasWatermark) {
      cmd.input(watermarkPath);
      wmIdx = nextInputIndex++;
    }

    const filters = [];
    const showHeader = template.overlayText !== false;
    const isLight = template.pageBackground === "white";
    const bgColor = BG_COLORS[template.pageBackground] || BG_COLORS.black;
    const primaryColor = isLight ? "0x0f1419" : "0xf7f9f9";
    const secondaryColor = isLight ? "0x536471" : "0x71767b";

    const cardWidth = Math.round((CW * (template.cardWidthPercent || 92)) / 100);
    const cardX = Math.round((CW - cardWidth) / 2);
    let currentY = template.topMargin || 130;

    const avatarSize = 74;
    const infoX = hasAvatar ? cardX + avatarSize + 20 : cardX;
    const nameFontSize = 30;
    const handleFontSize = 24;
    const titleFontSize = template.fontSize || 36;

    let headerTop = currentY;
    let nameY = currentY + 4;
    let handleY = currentY + 42;
    let titleLines = [];
    let titleY = 0;
    const lineHeight = Math.round(titleFontSize * 1.38);

    if (showHeader) {
      currentY += avatarSize + 24;
      if (template.title) {
        titleLines = wrapLines(template.title, cardWidth, titleFontSize);
        titleY = currentY;
        currentY += titleLines.length * lineHeight + 24;
      }
    } else {
      currentY = 0;
    }

    const videoBoxX = showHeader ? cardX : 0;
    const videoBoxY = showHeader ? currentY : 0;
    const videoBoxW = showHeader ? cardWidth : CW;
    const aspect = template.videoBoxAspect || "1:1";
    let videoBoxH;
    if (!showHeader) videoBoxH = CH;
    else if (aspect === "16:9") videoBoxH = Math.round(cardWidth * (9 / 16));
    else if (aspect === "4:5") videoBoxH = Math.round(cardWidth * (5 / 4));
    else videoBoxH = cardWidth;

    filters.push({ filter: "color", options: `c=${bgColor}:s=${CW}x${CH}:r=30`, outputs: "bg" });

    let vcur = "0:v";
    if (rotation === 90) {
      filters.push({ filter: "transpose", options: "1", inputs: vcur, outputs: "vrot" });
      vcur = "vrot";
    } else if (rotation === 270) {
      filters.push({ filter: "transpose", options: "2", inputs: vcur, outputs: "vrot" });
      vcur = "vrot";
    } else if (rotation === 180) {
      filters.push({ filter: "hflip", inputs: vcur, outputs: "vh" });
      filters.push({ filter: "vflip", inputs: "vh", outputs: "vrot" });
      vcur = "vrot";
    }

    const zoom = Math.min(2, Math.max(1, template.zoomScale || 1));
    const scaleTargetW = Math.round(videoBoxW * zoom);
    const scaleTargetH = Math.round(videoBoxH * zoom);
    filters.push({
      filter: "scale",
      options: `${scaleTargetW}:${scaleTargetH}:force_original_aspect_ratio=increase`,
      inputs: vcur,
      outputs: "vscaled",
    });

    const maxOffset = Math.round((scaleTargetH - videoBoxH) / 2);
    let offsetY = Math.round(template.centerOffsetY || 0);
    offsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY));
    const cropY = maxOffset + offsetY;

    filters.push({
      filter: "crop",
      options: `${videoBoxW}:${videoBoxH}:(in_w-out_w)/2:${cropY}`,
      inputs: "vscaled",
      outputs: "vcropped",
    });
    let vfinal = "vcropped";

    if (template.invert) {
      filters.push({ filter: "hflip", inputs: vfinal, outputs: "vflip2" });
      vfinal = "vflip2";
    }

    filters.push({
      filter: "overlay",
      options: `${videoBoxX}:${videoBoxY}:shortest=1`,
      inputs: ["bg", vfinal],
      outputs: "withvideo",
    });
    let current = "withvideo";

    if (showHeader) {
      if (hasAvatar) {
        filters.push({
          filter: "scale",
          options: `${avatarSize}:${avatarSize}`,
          inputs: `${logoIdx}:v`,
          outputs: "avatar_s",
        });
        filters.push({
          filter: "scale",
          options: `${avatarSize}:${avatarSize}`,
          inputs: `${maskIdx}:v`,
          outputs: "mask_s",
        });
        filters.push({ filter: "format", options: "gray", inputs: "mask_s", outputs: "mask_g" });
        filters.push({ filter: "alphamerge", inputs: ["avatar_s", "mask_g"], outputs: "avatar_circle" });
        filters.push({
          filter: "overlay",
          options: `${cardX}:${headerTop}`,
          inputs: [current, "avatar_circle"],
          outputs: "with_avatar",
        });
        current = "with_avatar";
      }

      if (template.name) {
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT_BOLD}:text='${escText(template.name)}':fontcolor=${primaryColor}:fontsize=${nameFontSize}:x=${infoX}:y=${nameY}`,
          inputs: current,
          outputs: "t_name",
        });
        current = "t_name";

        if (badgeIdx !== null) {
          const nameWidthEst = Math.round(String(template.name).length * nameFontSize * 0.58);
          const badgeSize = 26;
          const badgeX = infoX + nameWidthEst + 8;
          const badgeY = nameY + 2;
          filters.push({
            filter: "scale",
            options: `${badgeSize}:${badgeSize}`,
            inputs: `${badgeIdx}:v`,
            outputs: "badge_s",
          });
          filters.push({
            filter: "overlay",
            options: `${badgeX}:${badgeY}`,
            inputs: [current, "badge_s"],
            outputs: "with_badge",
          });
          current = "with_badge";
        }
      }

      if (template.handle) {
        const opacity = template.handleOpacity ?? 0.6;
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT_REG}:text='@${escText(template.handle)}':fontcolor=${secondaryColor}@${opacity}:fontsize=${handleFontSize}:x=${infoX}:y=${handleY}`,
          inputs: current,
          outputs: "t_handle",
        });
        current = "t_handle";
      }

      if (titleLines.length && template.title) {
        const joined = titleLines.map(escText).join("\n");
        const spacing = Math.round(titleFontSize * 0.38);
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT_BOLD}:text='${joined}':fontcolor=${primaryColor}:fontsize=${titleFontSize}:line_spacing=${spacing}:x=${cardX}:y=${titleY}`,
          inputs: current,
          outputs: "t_title",
        });
        current = "t_title";
      }
    }

    if (wmIdx !== null) {
      const opacity = template.watermark.opacity ?? 0.6;
      const pos = WM_POSITIONS[template.watermark.position] || WM_POSITIONS["bottom-right"];
      filters.push({ filter: "format", options: "rgba", inputs: `${wmIdx}:v`, outputs: "wm_rgba" });
      filters.push({ filter: "colorchannelmixer", options: `aa=${opacity}`, inputs: "wm_rgba", outputs: "wm_op" });
      filters.push({ filter: "overlay", options: pos, inputs: [current, "wm_op"], outputs: "outv" });
      current = "outv";
    }

    cmd
      .complexFilter(filters, current)
      .outputOptions([
        "-map 0:a?",
        "-c:v libx264",
        "-preset ultrafast",
        "-threads 1",
        "-crf 24",
        "-r 30",
        "-c:a aac",
        "-b:a 96k",
        "-movflags +faststart",
      ])
      .on("progress", (p) => onProgress && onProgress(p.percent || 0))
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}

module.exports = { processVideo };
