const ffmpeg = require("fluent-ffmpeg");

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const OUT_W = 1080;
const OUT_H = 1920;

function escText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

const WM_POSITIONS = {
  "top-left": "40:40",
  "top-right": "W-w-40:40",
  "bottom-left": "40:H-h-40",
  "bottom-right": "W-w-40:H-h-40",
  center: "(W-w)/2:(H-h)/2",
};

function processVideo({ inputVideo, logoPath, watermarkPath, template, outputPath, onProgress }) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputVideo);

    let nextInputIndex = 1;
    let logoIdx = null;
    let wmIdx = null;

    if (template.overlayText && logoPath) {
      cmd.input(logoPath);
      logoIdx = nextInputIndex++;
    }
    if (template.watermark && template.watermark.enabled && watermarkPath) {
      cmd.input(watermarkPath);
      wmIdx = nextInputIndex++;
    }

    const filters = [];

    filters.push({
      filter: "scale",
      options: `${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase`,
      inputs: "0:v",
      outputs: "scaled",
    });
    filters.push({
      filter: "crop",
      options: `${OUT_W}:${OUT_H}`,
      inputs: "scaled",
      outputs: "cropped",
    });

    let current = "cropped";

    if (template.invert) {
      filters.push({ filter: "hflip", inputs: current, outputs: "flipped" });
      current = "flipped";
    }

    if (template.overlayText) {
      if (logoIdx !== null) {
        filters.push({
          filter: "scale",
          options: "96:96",
          inputs: `${logoIdx}:v`,
          outputs: "logo_s",
        });
        filters.push({
          filter: "overlay",
          options: "56:130",
          inputs: [current, "logo_s"],
          outputs: "with_logo",
        });
        current = "with_logo";
      }

      const textX = logoIdx !== null ? "172" : "56";

      if (template.name) {
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT}:text='${escText(template.name)}':fontcolor=white:fontsize=38:x=${textX}:y=148:shadowcolor=black@0.6:shadowx=1:shadowy=1`,
          inputs: current,
          outputs: "t_name",
        });
        current = "t_name";
      }

      if (template.handle) {
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT}:text='@${escText(template.handle)}':fontcolor=white@0.65:fontsize=30:x=${textX}:y=198:shadowcolor=black@0.4:shadowx=1:shadowy=1`,
          inputs: current,
          outputs: "t_handle",
        });
        current = "t_handle";
      }

      if (template.title) {
        filters.push({
          filter: "drawtext",
          options: `fontfile=${FONT}:text='${escText(template.title)}':fontcolor=white:fontsize=34:x=56:y=280:line_spacing=6:box=1:boxcolor=black@0.30:boxborderw=14`,
          inputs: current,
          outputs: "t_title",
        });
        current = "t_title";
      }
    }

    if (wmIdx !== null) {
      const opacity = template.watermark.opacity ?? 0.6;
      const pos = WM_POSITIONS[template.watermark.position] || WM_POSITIONS["bottom-right"];
      filters.push({
        filter: "format",
        options: "rgba",
        inputs: `${wmIdx}:v`,
        outputs: "wm_rgba",
      });
      filters.push({
        filter: "colorchannelmixer",
        options: `aa=${opacity}`,
        inputs: "wm_rgba",
        outputs: "wm_op",
      });
      filters.push({
        filter: "overlay",
        options: pos,
        inputs: [current, "wm_op"],
        outputs: "outv",
      });
      current = "outv";
    }

    cmd
      .complexFilter(filters, current)
      .outputOptions(["-map 0:a?", "-c:v libx264", "-preset veryfast", "-crf 22", "-c:a aac", "-movflags +faststart"])
      .on("progress", (p) => onProgress && onProgress(p.percent || 0))
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}

module.exports = { processVideo };
