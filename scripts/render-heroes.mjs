import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const MODELS = ['tower', 'transformer', 'pole'];

const HTML = (modelUrl) => `<!DOCTYPE html>
<html><head>
<style>body{margin:0;background:#fff;overflow:hidden}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
</head><body>
<canvas id="c" width="460" height="393"></canvas>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(460, 393);
renderer.setClearColor(0xffffff, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 460/393, 0.1, 100);
camera.position.set(2.5, 1.8, 3.5);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dl = new THREE.DirectionalLight(0xffffff, 1.5);
dl.position.set(5, 5, 5);
scene.add(dl);
scene.add(new THREE.DirectionalLight(0xaaccff, 0.5)).position.set(-3, -1, 3);

new GLTFLoader().load('${modelUrl}', (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const s = 2.2 / maxDim;
  model.scale.setScalar(s);
  model.position.set(-center.x * s, -center.y * s, -center.z * s);
  scene.add(model);
  renderer.render(scene, camera);
  window.__rendered = true;
});
</script></body></html>`;

async function main() {
  const browser = await chromium.launch();

  for (const name of MODELS) {
    console.log(`Rendering ${name}...`);
    const page = await browser.newPage({ viewport: { width: 460, height: 393 } });

    // Serve the HTML with the model file
    await page.route('**/model.glb', async (route) => {
      const body = readFileSync(`public/models/${name}.glb`);
      await route.fulfill({ body, contentType: 'model/gltf-binary' });
    });

    const html = HTML('model.glb');
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForFunction('window.__rendered === true', { timeout: 10000 });
    await page.waitForTimeout(500);

    const pngPath = `/tmp/hero-${name}.png`;
    const el = page.locator('#c');
    await el.screenshot({ path: pngPath });
    console.log(`  Saved ${pngPath}`);
    await page.close();
  }

  await browser.close();

  // Now potrace each hero PNG
  for (const name of MODELS) {
    console.log(`Potracing ${name}...`);
    // Convert to BMP for potrace (threshold the image to black silhouette)
    execSync(`python3 -c "
from PIL import Image
img = Image.open('/tmp/hero-${name}.png').convert('RGB')
bmp = Image.new('1', img.size, 1)
for y in range(img.height):
    for x in range(img.width):
        r,g,b = img.getpixel((x,y))
        if (r+g+b) < 600:
            bmp.putpixel((x,y), 0)
bmp.save('/tmp/hero-${name}.bmp')
"`);

    execSync(`potrace /tmp/hero-${name}.bmp -s -o /tmp/hero-${name}.svg --flat`);
    console.log(`  Saved /tmp/hero-${name}.svg`);
  }

  console.log('\\nDone! SVGs at /tmp/hero-{tower,transformer,pole}.svg');
}

main().catch(console.error);
