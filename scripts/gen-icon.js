const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

function drawIcon(size, outputPath) {
  const png = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) * 4;

      // Normalize coords: x in [-1.35, 1.35], y flipped so point is at bottom
      const scale = 2.8;
      const nx = (x / size - 0.5) * scale;
      const ny = -(y / size - 0.5) * scale;

      // Anti-aliasing via supersampling (2x2)
      let fill = 0;
      const sub = 2;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const snx = (((x + (sx + 0.5) / sub) / size) - 0.5) * scale;
          const sny = -((((y + (sy + 0.5) / sub) / size) - 0.5) * scale);
          const v = Math.pow(snx*snx + sny*sny - 1, 3) - snx*snx * Math.pow(sny, 3);
          if (v <= 0) fill++;
        }
      }
      const t = fill / (sub * sub);

      // Heart color: #FF6B9D (pink), background: white
      png.data[idx]   = Math.round(255 * (1 - t) + 255 * t);
      png.data[idx+1] = Math.round(255 * (1 - t) + 107 * t);
      png.data[idx+2] = Math.round(255 * (1 - t) + 157 * t);
      png.data[idx+3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(outputPath, buffer);
  console.log('Written:', outputPath);
}

const pub = path.join(__dirname, '..', 'public');
drawIcon(192, path.join(pub, 'logo192.png'));
drawIcon(512, path.join(pub, 'logo512.png'));
