const DEFAULT_ADJUSTMENTS = Object.freeze({
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  rotation: 0,
  brightness: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  grayscale: false
});

const DEFAULT_HEIGHT_MAP = Object.freeze({
  layerCount: 12,
  layerHeight: 0.08,
  minHeight: 0.24,
  maxHeight: 1.2,
  invert: false
});

let dirty = false;
let projectImage = null;
let imageAdjustments = { ...DEFAULT_ADJUSTMENTS };
let heightMapSettings = { ...DEFAULT_HEIGHT_MAP };
let paletteRanges = [];
let sourceImage = null;
let autosaveTimer = null;
let renderFrame = null;
let heightMapFrame = null;
let paletteFrame = null;
let revision = 0;
let saveQueue = Promise.resolve();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const pageTitles = {
  projects: 'Projects',
  image: 'Image',
  heightmap: 'Height Map',
  palette: 'Palette',
  inventory: 'Inventory',
  layers: 'Layers',
  settings: 'Settings'
};
const adjustmentIds = [
  'cropTop',
  'cropRight',
  'cropBottom',
  'cropLeft',
  'brightness',
  'contrast',
  'shadows',
  'highlights'
];

function clamp(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeAdjustments(value) {
  const rotation = Math.round(Number(value?.rotation) / 90) * 90;

  return {
    cropTop: clamp(value?.cropTop, 0, 45),
    cropRight: clamp(value?.cropRight, 0, 45),
    cropBottom: clamp(value?.cropBottom, 0, 45),
    cropLeft: clamp(value?.cropLeft, 0, 45),
    rotation: ((rotation % 360) + 360) % 360,
    brightness: clamp(value?.brightness, -100, 100),
    contrast: clamp(value?.contrast, -100, 100),
    shadows: clamp(value?.shadows, -100, 100),
    highlights: clamp(value?.highlights, -100, 100),
    grayscale: Boolean(value?.grayscale)
  };
}

function normalizeHeightMap(value) {
  const layerHeight = clamp(value?.layerHeight, 0.02, 0.4, DEFAULT_HEIGHT_MAP.layerHeight);
  const requestedMinimum = clamp(value?.minHeight, 0, 20, DEFAULT_HEIGHT_MAP.minHeight);
  const minimumSteps = Math.max(0, Math.round(requestedMinimum / layerHeight));
  const minHeight = minimumSteps * layerHeight;
  const requestedMaximum = clamp(value?.maxHeight, minHeight + layerHeight, 40, DEFAULT_HEIGHT_MAP.maxHeight);
  const reliefSteps = Math.max(1, Math.round((requestedMaximum - minHeight) / layerHeight));
  const maxHeight = Math.min(40, minHeight + reliefSteps * layerHeight);

  return {
    layerCount: Math.round(clamp(value?.layerCount, 2, 64, DEFAULT_HEIGHT_MAP.layerCount)),
    layerHeight,
    minHeight,
    maxHeight,
    invert: Boolean(value?.invert)
  };
}

function normalizePalette(value) {
  const source = Array.isArray(value?.ranges) ? value.ranges : [];
  return source.slice(0, 64).map((range, index) => ({
    id: String(range?.id || id(`palette-${index + 1}`)),
    filamentId: String(range?.filamentId || ''),
    endBand: Math.round(clamp(range?.endBand, 1, 64, index + 1))
  }));
}

function status(text, saved = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('saved', saved);
}

function changed() {
  revision += 1;
  dirty = true;
  status('Unsaved local changes');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => save(true), 900);
}

function showPage(name) {
  $$('.nav').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  $$('.page').forEach((page) => page.classList.toggle('active', page.id === name));
  $('#title').textContent = pageTitles[name] || name;
}

function inventoryRow(item = {}) {
  const row = document.createElement('tr');
  row.dataset.id = item.id || id('filament');
  row.innerHTML = `<td><input class="color hex" type="color"></td><td><input class="brand"></td><td><input class="colorName"></td><td><input class="material"></td><td><input class="td" type="number" min="0" step="0.01" placeholder="Pending"></td><td><input class="grams" type="number" min="0"></td><td><button class="remove" type="button">×</button></td>`;
  row.querySelector('.hex').value = item.hex || '#777777';
  row.querySelector('.brand').value = item.brand || '';
  row.querySelector('.colorName').value = item.color || 'New filament';
  row.querySelector('.material').value = item.material || 'PLA';
  row.querySelector('.td').value = item.td ?? '';
  row.querySelector('.grams').value = item.grams ?? 1000;
  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', inventoryChanged));
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    inventoryChanged();
  });
  return row;
}

function layerRow(item = {}) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.id = item.id || id('layer');
  row.innerHTML = `<input class="enabled" type="checkbox"><input class="color layerColor" type="color"><input class="layerName"><label><span>Thickness</span><input class="thickness" type="number" min="0.02" step="0.02"></label><button class="remove" type="button">×</button>`;
  row.querySelector('.enabled').checked = item.enabled !== false;
  row.querySelector('.layerColor').value = item.color || '#7c5cff';
  row.querySelector('.layerName').value = item.name || 'New layer';
  row.querySelector('.thickness').value = Number(item.thickness || 0.24).toFixed(2);
  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
    changed();
    summarize();
  }));
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    changed();
    summarize();
  });
  return row;
}

function collectInventory() {
  return $$('#inventoryBody tr').map((row) => ({
    id: row.dataset.id,
    hex: row.querySelector('.hex').value,
    brand: row.querySelector('.brand').value,
    color: row.querySelector('.colorName').value,
    material: row.querySelector('.material').value,
    td: row.querySelector('.td').value,
    grams: row.querySelector('.grams').value
  }));
}

function collectLayers() {
  return $$('#layerList .row').map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector('.enabled').checked,
    color: row.querySelector('.layerColor').value,
    name: row.querySelector('.layerName').value,
    thickness: row.querySelector('.thickness').value
  }));
}

function collectData() {
  return {
    project: {
      name: $('#projectName').value,
      notes: $('#projectNotes').value,
      image: projectImage,
      imageAdjustments,
      heightMap: heightMapSettings,
      palette: { ranges: paletteRanges }
    },
    inventory: collectInventory(),
    layers: collectLayers(),
    settings: {
      layerHeight: $('#layerHeight').value,
      printWidth: $('#printWidth').value
    }
  };
}

function summarize() {
  const layers = collectLayers().filter((layer) => layer.enabled);
  $('#stack').replaceChildren(...layers.map((layer, index) => {
    const segment = document.createElement('div');
    segment.className = 'segment';
    segment.style.background = layer.color;
    segment.textContent = index + 1;
    segment.title = layer.name;
    return segment;
  }));
  const height = layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
  $('#enabled').textContent = layers.length;
  $('#height').textContent = `${height.toFixed(2)} mm`;
  $('#swaps').textContent = Math.max(0, layers.length - 1);
}

function updateAdjustmentOutputs() {
  adjustmentIds.forEach((controlId) => {
    const input = $(`#${controlId}`);
    const output = $(`#${controlId}Value`);
    const suffix = controlId.startsWith('crop') ? '%' : '';
    output.textContent = `${input.value}${suffix}`;
  });
  $('#rotationValue').textContent = `${imageAdjustments.rotation}°`;
}

function applyAdjustmentControls() {
  adjustmentIds.forEach((controlId) => {
    $(`#${controlId}`).value = imageAdjustments[controlId];
  });
  $('#grayscale').checked = imageAdjustments.grayscale;
  updateAdjustmentOutputs();
}

function readAdjustmentControls() {
  return normalizeAdjustments({
    cropTop: $('#cropTop').value,
    cropRight: $('#cropRight').value,
    cropBottom: $('#cropBottom').value,
    cropLeft: $('#cropLeft').value,
    rotation: imageAdjustments.rotation,
    brightness: $('#brightness').value,
    contrast: $('#contrast').value,
    shadows: $('#shadows').value,
    highlights: $('#highlights').value,
    grayscale: $('#grayscale').checked
  });
}

function applyHeightMapControls() {
  $('#heightLayerCount').value = heightMapSettings.layerCount;
  $('#heightLayerHeight').value = heightMapSettings.layerHeight.toFixed(2);
  $('#heightMin').step = heightMapSettings.layerHeight.toFixed(2);
  $('#heightMax').step = heightMapSettings.layerHeight.toFixed(2);
  $('#heightMin').value = heightMapSettings.minHeight.toFixed(2);
  $('#heightMax').value = heightMapSettings.maxHeight.toFixed(2);
  $('#heightInvert').checked = heightMapSettings.invert;
}

function readHeightMapControls() {
  return normalizeHeightMap({
    layerCount: $('#heightLayerCount').value,
    layerHeight: $('#heightLayerHeight').value,
    minHeight: $('#heightMin').value,
    maxHeight: $('#heightMax').value,
    invert: $('#heightInvert').checked
  });
}

function setWorkspaceControlsEnabled(enabled) {
  $('#adjustmentControls').disabled = !enabled;
  $('#removeImage').disabled = !enabled;
  $('#heightMapControls').disabled = !enabled;
  $('#exportHeightMap').disabled = !enabled;
  $('#exportSchedule').disabled = !enabled || !paletteRanges.length;
}

function setImageMetadataEmpty(message = 'No saved source image') {
  $('#sourceDimensions').textContent = '—';
  $('#preparedDimensions').textContent = '—';
  $('#aspectRatio').textContent = '—';
  $('#rotationMeta').textContent = '—';
  $('#previewMode').textContent = message;
}

function setHeightMapMetadataEmpty(message = 'Choose an image to generate a height map.') {
  $('#heightMapDimensions').textContent = '—';
  $('#requestedBands').textContent = '—';
  $('#usedLevels').textContent = '—';
  $('#printableSteps').textContent = '—';
  $('#heightRange').textContent = '—';
  $('#reliefDepth').textContent = '—';
  $('#gradientLow').textContent = 'Minimum';
  $('#gradientHigh').textContent = 'Maximum';
  $('#heightExportStatus').textContent = message;
}

function setPaletteMetadataEmpty(message = 'Add inventory colors and prepare an image.') {
  $('#paletteColorCount').textContent = '—';
  $('#paletteRangeCount').textContent = '—';
  $('#paletteSwapCount').textContent = '—';
  $('#paletteBandCount').textContent = '—';
  $('#paletteStatus').textContent = message;
  $('#scheduleBody').replaceChildren();
}

function clearHeightMapPreview(message = 'Choose and prepare an image first') {
  const canvas = $('#heightMapCanvas');
  const context = canvas.getContext('2d');
  canvas.width = 1;
  canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
  canvas.classList.remove('show');
  $('#heightMapPlaceholder').hidden = false;
  $('#heightMapPlaceholder').textContent = message;
  setHeightMapMetadataEmpty(message);
}

function clearPalettePreview(message = 'Choose and prepare an image first') {
  const canvas = $('#paletteCanvas');
  const context = canvas.getContext('2d');
  canvas.width = 1;
  canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
  canvas.classList.remove('show');
  $('#palettePlaceholder').hidden = false;
  $('#palettePlaceholder').textContent = message;
  setPaletteMetadataEmpty(message);
}

function clearImagePreview(message = 'Choose an image to begin preparing it') {
  sourceImage = null;
  const canvas = $('#previewCanvas');
  const context = canvas.getContext('2d');
  canvas.width = 1;
  canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
  canvas.classList.remove('show');
  $('#placeholder').hidden = false;
  $('#placeholder').textContent = message;
  $('#imageName').textContent = projectImage?.originalName || 'No image selected';
  setWorkspaceControlsEnabled(Boolean(projectImage));
  setImageMetadataEmpty(message);
  clearHeightMapPreview(projectImage ? 'Saved image could not be prepared.' : 'Choose and prepare an image first');
  clearPalettePreview(projectImage ? 'Saved image could not be prepared.' : 'Choose and prepare an image first');
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The saved image could not be decoded.'));
    image.src = dataUrl;
  });
}

function formatAspectRatio(width, height) {
  if (!width || !height) return '—';
  const ratio = width / height;
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

function formatMillimeters(value) {
  return `${Number(value).toFixed(2)} mm`;
}

function renderPreparedImage() {
  if (!sourceImage) return;

  const adjustments = normalizeAdjustments(imageAdjustments);
  const sourceWidth = sourceImage.naturalWidth;
  const sourceHeight = sourceImage.naturalHeight;
  const sourceX = Math.round(sourceWidth * adjustments.cropLeft / 100);
  const sourceY = Math.round(sourceHeight * adjustments.cropTop / 100);
  const cropWidth = Math.max(1, Math.round(sourceWidth * (100 - adjustments.cropLeft - adjustments.cropRight) / 100));
  const cropHeight = Math.max(1, Math.round(sourceHeight * (100 - adjustments.cropTop - adjustments.cropBottom) / 100));
  const quarterTurn = adjustments.rotation === 90 || adjustments.rotation === 270;
  const preparedWidth = quarterTurn ? cropHeight : cropWidth;
  const preparedHeight = quarterTurn ? cropWidth : cropHeight;
  const previewScale = Math.min(1, 1400 / Math.max(preparedWidth, preparedHeight));
  const canvas = $('#previewCanvas');
  const canvasWidth = Math.max(1, Math.round(preparedWidth * previewScale));
  const canvasHeight = Math.max(1, Math.round(preparedHeight * previewScale));

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  context.translate(canvasWidth / 2, canvasHeight / 2);
  context.rotate(adjustments.rotation * Math.PI / 180);
  context.drawImage(
    sourceImage,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    -cropWidth * previewScale / 2,
    -cropHeight * previewScale / 2,
    cropWidth * previewScale,
    cropHeight * previewScale
  );
  context.restore();

  const pixels = context.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = pixels.data;
  const brightnessOffset = adjustments.brightness / 100 * 0.35;
  const contrastFactor = 1 + adjustments.contrast / 100 * 1.8;
  const shadowStrength = adjustments.shadows / 100 * 0.38;
  const highlightStrength = adjustments.highlights / 100 * 0.38;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;

    let red = data[index] / 255;
    let green = data[index + 1] / 255;
    let blue = data[index + 2] / 255;

    red = (red + brightnessOffset - 0.5) * contrastFactor + 0.5;
    green = (green + brightnessOffset - 0.5) * contrastFactor + 0.5;
    blue = (blue + brightnessOffset - 0.5) * contrastFactor + 0.5;

    const luminance = clamp(0.2126 * red + 0.7152 * green + 0.0722 * blue, 0, 1);
    const tonalOffset = shadowStrength * (1 - luminance) + highlightStrength * luminance;

    red = clamp(red + tonalOffset, 0, 1);
    green = clamp(green + tonalOffset, 0, 1);
    blue = clamp(blue + tonalOffset, 0, 1);

    if (adjustments.grayscale) {
      const gray = clamp(0.2126 * red + 0.7152 * green + 0.0722 * blue, 0, 1);
      red = gray;
      green = gray;
      blue = gray;
    }

    data[index] = Math.round(red * 255);
    data[index + 1] = Math.round(green * 255);
    data[index + 2] = Math.round(blue * 255);
  }

  context.putImageData(pixels, 0, 0);
  canvas.classList.add('show');
  $('#placeholder').hidden = true;
  $('#sourceDimensions').textContent = `${sourceWidth} × ${sourceHeight} px`;
  $('#preparedDimensions').textContent = `${preparedWidth} × ${preparedHeight} px`;
  $('#aspectRatio').textContent = formatAspectRatio(preparedWidth, preparedHeight);
  $('#rotationMeta').textContent = `${adjustments.rotation}°`;
  $('#previewMode').textContent = adjustments.grayscale
    ? 'Grayscale luminance preview. The original color image remains untouched.'
    : 'Prepared color preview. The original image remains untouched.';

  scheduleHeightMapRender();
  schedulePaletteRender();
}

function analyzeHeightMap() {
  const prepared = $('#previewCanvas');
  if (!sourceImage || prepared.width <= 1 || prepared.height <= 1) return null;

  const context = prepared.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, prepared.width, prepared.height);
  const indexes = new Int16Array(prepared.width * prepared.height);
  const alphas = new Uint8Array(prepared.width * prepared.height);
  const used = new Set();
  const bands = heightMapSettings.layerCount;

  for (let pixel = 0, offset = 0; pixel < indexes.length; pixel += 1, offset += 4) {
    const alpha = pixels.data[offset + 3];
    alphas[pixel] = alpha;
    if (alpha === 0) {
      indexes[pixel] = -1;
      continue;
    }

    const luminance = clamp(
      (0.2126 * pixels.data[offset] + 0.7152 * pixels.data[offset + 1] + 0.0722 * pixels.data[offset + 2]) / 255,
      0,
      1
    );
    const directed = heightMapSettings.invert ? 1 - luminance : luminance;
    const bandIndex = Math.round(directed * (bands - 1));
    indexes[pixel] = bandIndex;
    used.add(bandIndex);
  }

  return {
    width: prepared.width,
    height: prepared.height,
    indexes,
    alphas,
    usedLevels: used.size,
    printableSteps: Math.max(1, Math.round((heightMapSettings.maxHeight - heightMapSettings.minHeight) / heightMapSettings.layerHeight))
  };
}

function bandHeight(oneBasedBand) {
  const band = Math.round(clamp(oneBasedBand, 1, heightMapSettings.layerCount, 1));
  const steps = Math.max(1, Math.round((heightMapSettings.maxHeight - heightMapSettings.minHeight) / heightMapSettings.layerHeight));
  const step = Math.round(((band - 1) / Math.max(1, heightMapSettings.layerCount - 1)) * steps);
  return heightMapSettings.minHeight + step * heightMapSettings.layerHeight;
}

function renderHeightMap() {
  const analysis = analyzeHeightMap();
  if (!analysis) {
    clearHeightMapPreview();
    return;
  }

  const canvas = $('#heightMapCanvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const context = canvas.getContext('2d');
  const output = context.createImageData(analysis.width, analysis.height);
  const bands = heightMapSettings.layerCount;

  for (let pixel = 0, offset = 0; pixel < analysis.indexes.length; pixel += 1, offset += 4) {
    const bandIndex = analysis.indexes[pixel];
    if (bandIndex < 0) {
      output.data[offset + 3] = 0;
      continue;
    }
    const gray = Math.round((bandIndex / Math.max(1, bands - 1)) * 255);
    output.data[offset] = gray;
    output.data[offset + 1] = gray;
    output.data[offset + 2] = gray;
    output.data[offset + 3] = analysis.alphas[pixel];
  }

  context.putImageData(output, 0, 0);
  canvas.classList.add('show');
  $('#heightMapPlaceholder').hidden = true;
  $('#heightMapDimensions').textContent = `${analysis.width} × ${analysis.height} px`;
  $('#requestedBands').textContent = heightMapSettings.layerCount;
  $('#usedLevels').textContent = analysis.usedLevels;
  $('#printableSteps').textContent = analysis.printableSteps + 1;
  $('#heightRange').textContent = `${formatMillimeters(heightMapSettings.minHeight)} – ${formatMillimeters(heightMapSettings.maxHeight)}`;
  $('#reliefDepth').textContent = formatMillimeters(heightMapSettings.maxHeight - heightMapSettings.minHeight);
  $('#gradientLow').textContent = heightMapSettings.invert ? 'Light pixels · minimum' : 'Dark pixels · minimum';
  $('#gradientHigh').textContent = heightMapSettings.invert ? 'Dark pixels · maximum' : 'Light pixels · maximum';
  $('#heightExportStatus').textContent = 'Height map ready to export.';
}

function schedulePreparedRender() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderPreparedImage();
  });
}

function scheduleHeightMapRender() {
  if (heightMapFrame) cancelAnimationFrame(heightMapFrame);
  heightMapFrame = requestAnimationFrame(() => {
    heightMapFrame = null;
    renderHeightMap();
  });
}

function schedulePaletteRender() {
  if (paletteFrame) cancelAnimationFrame(paletteFrame);
  paletteFrame = requestAnimationFrame(() => {
    paletteFrame = null;
    renderPalettePreview();
  });
}

function inventoryMap() {
  return new Map(collectInventory().map((item) => [item.id, item]));
}

function seedPaletteRanges() {
  const inventory = collectInventory();
  const count = Math.min(4, inventory.length, heightMapSettings.layerCount);
  paletteRanges = [];

  for (let index = 0; index < count; index += 1) {
    paletteRanges.push({
      id: id('palette'),
      filamentId: inventory[index].id,
      endBand: index === count - 1
        ? heightMapSettings.layerCount
        : Math.max(index + 1, Math.round(((index + 1) / count) * heightMapSettings.layerCount))
    });
  }
}

function reconcilePaletteRanges(seedWhenEmpty = true) {
  const inventory = collectInventory();
  const inventoryIds = new Set(inventory.map((item) => item.id));
  const bandCount = heightMapSettings.layerCount;

  paletteRanges = normalizePalette({ ranges: paletteRanges })
    .slice(0, Math.min(64, bandCount))
    .map((range) => ({
      ...range,
      filamentId: inventoryIds.has(range.filamentId) ? range.filamentId : (inventory[0]?.id || '')
    }));

  if (!paletteRanges.length && seedWhenEmpty && inventory.length) seedPaletteRanges();
  if (!paletteRanges.length) return;

  let previousEnd = 0;
  paletteRanges = paletteRanges.map((range, index) => {
    const remaining = paletteRanges.length - index - 1;
    const minimumEnd = previousEnd + 1;
    const maximumEnd = bandCount - remaining;
    const endBand = index === paletteRanges.length - 1
      ? bandCount
      : Math.round(clamp(range.endBand, minimumEnd, maximumEnd, minimumEnd));
    previousEnd = endBand;
    return { ...range, endBand };
  });
}

function rangeStart(index) {
  return index === 0 ? 1 : paletteRanges[index - 1].endBand + 1;
}

function filamentLabel(item) {
  const name = item.color || 'Unnamed color';
  const brand = item.brand ? ` · ${item.brand}` : '';
  const material = item.material ? ` · ${item.material}` : '';
  return `${name}${brand}${material}`;
}

function renderPaletteRanges() {
  reconcilePaletteRanges();
  const inventory = collectInventory();
  const map = new Map(inventory.map((item) => [item.id, item]));
  const list = $('#paletteRanges');
  list.replaceChildren();

  if (!inventory.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'Add at least one filament in Inventory before building a project palette.';
    list.append(empty);
    $('#addPaletteRange').disabled = true;
    $('#autoPalette').disabled = true;
    $('#exportSchedule').disabled = true;
    return;
  }

  $('#autoPalette').disabled = false;
  $('#addPaletteRange').disabled = paletteRanges.length >= heightMapSettings.layerCount;
  $('#exportSchedule').disabled = !sourceImage || !paletteRanges.length;

  paletteRanges.forEach((range, index) => {
    const item = map.get(range.filamentId) || inventory[0];
    const row = document.createElement('div');
    row.className = 'palette-range-row';

    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.background = item?.hex || '#ff00ff';
    swatch.title = item ? filamentLabel(item) : 'Missing filament';

    const details = document.createElement('div');
    details.className = 'palette-range-main';

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Filament for bands ${rangeStart(index)} through ${range.endBand}`);
    inventory.forEach((filament) => {
      const option = document.createElement('option');
      option.value = filament.id;
      option.textContent = filamentLabel(filament);
      select.append(option);
    });
    select.value = range.filamentId;
    select.addEventListener('change', () => {
      paletteRanges[index].filamentId = select.value;
      renderPaletteWorkspace();
      changed();
    });

    const bandLabel = document.createElement('span');
    bandLabel.className = 'palette-band-label';
    bandLabel.textContent = `Height bands ${rangeStart(index)}–${range.endBand}`;
    details.append(select, bandLabel);

    const endLabel = document.createElement('label');
    endLabel.className = 'palette-end-label';
    const endCaption = document.createElement('span');
    endCaption.textContent = 'Through band';
    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.min = String(rangeStart(index));
    endInput.max = String(heightMapSettings.layerCount);
    endInput.step = '1';
    endInput.value = String(range.endBand);
    endInput.disabled = index === paletteRanges.length - 1;
    endInput.addEventListener('change', () => {
      paletteRanges[index].endBand = Number(endInput.value);
      reconcilePaletteRanges();
      renderPaletteWorkspace();
      changed();
    });
    endLabel.append(endCaption, endInput);

    const controls = document.createElement('div');
    controls.className = 'palette-range-actions';
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.textContent = '↑';
    earlier.title = 'Move this color earlier';
    earlier.disabled = index === 0;
    earlier.addEventListener('click', () => movePaletteColor(index, -1));
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = '↓';
    later.title = 'Move this color later';
    later.disabled = index === paletteRanges.length - 1;
    later.addEventListener('click', () => movePaletteColor(index, 1));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove this color range';
    remove.className = 'remove';
    remove.disabled = paletteRanges.length === 1;
    remove.addEventListener('click', () => {
      paletteRanges.splice(index, 1);
      reconcilePaletteRanges();
      renderPaletteWorkspace();
      changed();
    });
    controls.append(earlier, later, remove);

    row.append(swatch, details, endLabel, controls);
    list.append(row);
  });
}

function movePaletteColor(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= paletteRanges.length) return;
  const filamentId = paletteRanges[index].filamentId;
  paletteRanges[index].filamentId = paletteRanges[target].filamentId;
  paletteRanges[target].filamentId = filamentId;
  renderPaletteWorkspace();
  changed();
}

function addPaletteRange() {
  const inventory = collectInventory();
  if (!inventory.length || paletteRanges.length >= heightMapSettings.layerCount) return;
  reconcilePaletteRanges();

  let widestIndex = -1;
  let widestWidth = 0;
  paletteRanges.forEach((range, index) => {
    const width = range.endBand - rangeStart(index) + 1;
    if (width > widestWidth) {
      widestWidth = width;
      widestIndex = index;
    }
  });
  if (widestIndex < 0 || widestWidth < 2) return;

  const range = paletteRanges[widestIndex];
  const start = rangeStart(widestIndex);
  const oldEnd = range.endBand;
  const split = start + Math.floor(widestWidth / 2) - 1;
  range.endBand = split;
  const used = new Set(paletteRanges.map((entry) => entry.filamentId));
  const nextFilament = inventory.find((item) => !used.has(item.id)) || inventory[(widestIndex + 1) % inventory.length];
  paletteRanges.splice(widestIndex + 1, 0, {
    id: id('palette'),
    filamentId: nextFilament.id,
    endBand: oldEnd
  });
  reconcilePaletteRanges();
  renderPaletteWorkspace();
  changed();
}

function autoDistributePalette() {
  seedPaletteRanges();
  reconcilePaletteRanges();
  renderPaletteWorkspace();
  changed();
}

function effectivePaletteRanges() {
  reconcilePaletteRanges();
  const merged = [];
  paletteRanges.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.filamentId === range.filamentId) {
      previous.endBand = range.endBand;
    } else {
      merged.push({ ...range });
    }
  });
  return merged;
}

function parseHex(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return [255, 0, 255];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function paletteRangeForBand(oneBasedBand) {
  return paletteRanges.find((range) => oneBasedBand <= range.endBand) || paletteRanges[paletteRanges.length - 1];
}

function buildScheduleRows() {
  const inventory = inventoryMap();
  const ranges = effectivePaletteRanges();
  let previousEnd = 0;

  return ranges.map((range, index) => {
    const startBand = previousEnd + 1;
    const endBand = range.endBand;
    const item = inventory.get(range.filamentId) || {
      color: 'Missing filament',
      brand: '',
      material: '',
      hex: '#ff00ff',
      td: ''
    };
    const minimumTarget = bandHeight(startBand);
    const maximumTarget = bandHeight(endBand);
    let startLayer = 1;
    let startZ = heightMapSettings.layerHeight;

    if (index > 0) {
      const previousHeight = bandHeight(startBand - 1);
      startLayer = Math.round(previousHeight / heightMapSettings.layerHeight) + 1;
      startZ = startLayer * heightMapSettings.layerHeight;
    }

    previousEnd = endBand;
    return {
      step: index + 1,
      action: index === 0 ? 'Start with' : 'Change to',
      filament: item,
      startBand,
      endBand,
      minimumTarget,
      maximumTarget,
      startLayer,
      startZ
    };
  });
}

function renderSchedule() {
  const body = $('#scheduleBody');
  body.replaceChildren();
  const rows = buildScheduleRows();

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const step = document.createElement('td');
    step.textContent = String(row.step);
    const action = document.createElement('td');
    action.textContent = row.action;
    const filament = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'schedule-color-chip';
    chip.style.background = row.filament.hex || '#ff00ff';
    const name = document.createElement('span');
    name.textContent = filamentLabel(row.filament);
    filament.append(chip, name);
    const bands = document.createElement('td');
    bands.textContent = `${row.startBand}–${row.endBand}`;
    const layer = document.createElement('td');
    layer.textContent = String(row.startLayer);
    const z = document.createElement('td');
    z.textContent = formatMillimeters(row.startZ);
    const target = document.createElement('td');
    target.textContent = `${formatMillimeters(row.minimumTarget)}–${formatMillimeters(row.maximumTarget)}`;
    tr.append(step, action, filament, bands, layer, z, target);
    body.append(tr);
  });
}

function renderPalettePreview() {
  reconcilePaletteRanges();
  renderSchedule();
  const analysis = analyzeHeightMap();
  const inventory = inventoryMap();

  if (!analysis || !paletteRanges.length || !inventory.size) {
    clearPalettePreview(!inventory.size ? 'Add filament colors in Inventory first.' : 'Choose and prepare an image first.');
    renderSchedule();
    return;
  }

  const canvas = $('#paletteCanvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const context = canvas.getContext('2d');
  const output = context.createImageData(analysis.width, analysis.height);
  const colorCache = new Map();

  paletteRanges.forEach((range) => {
    const item = inventory.get(range.filamentId);
    colorCache.set(range.filamentId, parseHex(item?.hex));
  });

  for (let pixel = 0, offset = 0; pixel < analysis.indexes.length; pixel += 1, offset += 4) {
    const bandIndex = analysis.indexes[pixel];
    if (bandIndex < 0) {
      output.data[offset + 3] = 0;
      continue;
    }
    const range = paletteRangeForBand(bandIndex + 1);
    const [red, green, blue] = colorCache.get(range?.filamentId) || [255, 0, 255];
    output.data[offset] = red;
    output.data[offset + 1] = green;
    output.data[offset + 2] = blue;
    output.data[offset + 3] = analysis.alphas[pixel];
  }

  context.putImageData(output, 0, 0);
  canvas.classList.add('show');
  $('#palettePlaceholder').hidden = true;
  const effective = effectivePaletteRanges();
  const uniqueColors = new Set(effective.map((range) => range.filamentId));
  $('#paletteColorCount').textContent = uniqueColors.size;
  $('#paletteRangeCount').textContent = effective.length;
  $('#paletteSwapCount').textContent = Math.max(0, effective.length - 1);
  $('#paletteBandCount').textContent = heightMapSettings.layerCount;
  $('#paletteStatus').textContent = 'Direct filament-color preview. TD blending is not applied yet.';
  $('#exportSchedule').disabled = !effective.length;
}

function renderPaletteWorkspace() {
  renderPaletteRanges();
  schedulePaletteRender();
}

function colorScheduleText() {
  const rows = buildScheduleRows();
  const lines = [
    'FILAMENT PAINTING LAB',
    'COLOR-CHANGE SCHEDULE',
    '',
    `Project: ${$('#projectName').value || 'Untitled filament painting'}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Height bands: ${heightMapSettings.layerCount}`,
    `Layer height: ${heightMapSettings.layerHeight.toFixed(2)} mm`,
    `Height range: ${heightMapSettings.minHeight.toFixed(2)}–${heightMapSettings.maxHeight.toFixed(2)} mm`,
    `Height direction: ${heightMapSettings.invert ? 'Dark pixels are tallest' : 'Light pixels are tallest'}`,
    '',
    'PRINT SEQUENCE'
  ];

  rows.forEach((row) => {
    const td = row.filament.td === '' || row.filament.td == null ? 'TD pending' : `TD ${row.filament.td}`;
    lines.push(
      `${row.step}. ${row.action} ${filamentLabel(row.filament)}`,
      `   Start layer: ${row.startLayer}`,
      `   Start Z: ${row.startZ.toFixed(2)} mm`,
      `   Height bands: ${row.startBand}–${row.endBand}`,
      `   Target height range: ${row.minimumTarget.toFixed(2)}–${row.maximumTarget.toFixed(2)} mm`,
      `   Color: ${row.filament.hex || 'Unknown'} · ${td}`
    );
  });

  lines.push(
    '',
    'NOTE',
    'This milestone assigns solid inventory colors directly to height bands. It does not yet simulate transmission distance or optical blending.'
  );
  return `${lines.join('\r\n')}\r\n`;
}

async function renderSavedImage() {
  clearImagePreview();
  if (!projectImage) return;

  const result = await window.lab.readImage(projectImage);
  if (!result?.ok) {
    clearImagePreview('Saved image file is missing');
    return;
  }

  sourceImage = await loadImageElement(result.dataUrl);
  $('#imageName').textContent = projectImage.originalName;
  setWorkspaceControlsEnabled(true);
  renderPreparedImage();
}

async function fill(data) {
  $('#projectName').value = data.project?.name || '';
  $('#projectNotes').value = data.project?.notes || '';
  $('#layerHeight').value = String(data.settings?.layerHeight || 0.08);
  $('#printWidth').value = data.settings?.printWidth || 200;
  $('#inventoryBody').replaceChildren(...(data.inventory || []).map(inventoryRow));
  $('#layerList').replaceChildren(...(data.layers || []).map(layerRow));
  projectImage = data.project?.image || null;
  imageAdjustments = normalizeAdjustments(data.project?.imageAdjustments || DEFAULT_ADJUSTMENTS);
  heightMapSettings = normalizeHeightMap(data.project?.heightMap || DEFAULT_HEIGHT_MAP);
  paletteRanges = normalizePalette(data.project?.palette);
  applyAdjustmentControls();
  applyHeightMapControls();
  reconcilePaletteRanges();
  renderPaletteRanges();
  summarize();
  await renderSavedImage();
  renderPaletteWorkspace();
}

async function performSave(automatic, data, saveRevision) {
  status(automatic ? 'Autosaving...' : 'Saving...');

  try {
    const result = await window.lab.save(data);
    if (!result?.ok) throw new Error('The main process did not confirm the save.');
    $('#dataPath').textContent = result.path;

    if (revision === saveRevision) {
      dirty = false;
      const savedTime = new Date(result.savedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      });
      status(`Saved and verified at ${savedTime}`, true);
    } else {
      status('Unsaved local changes');
    }
    return true;
  } catch (error) {
    console.error(error);
    dirty = true;
    status('Save failed');
    return false;
  }
}

function save(automatic = false) {
  clearTimeout(autosaveTimer);
  reconcilePaletteRanges();
  const data = collectData();
  const saveRevision = revision;
  const task = () => performSave(automatic, data, saveRevision);
  const result = saveQueue.then(task, task);
  saveQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function importSelectedImage(file) {
  const previousImage = projectImage;
  const previousAdjustments = imageAdjustments;
  status('Copying image into local project storage...');

  try {
    const result = await window.lab.importImage({
      originalName: file.name,
      mime: file.type,
      bytes: await file.arrayBuffer()
    });
    if (!result?.ok || !result.image) throw new Error('The image import was not confirmed.');

    projectImage = result.image;
    imageAdjustments = { ...DEFAULT_ADJUSTMENTS };
    applyAdjustmentControls();
    await renderSavedImage();
    changed();

    const saved = await save(false);
    if (!saved) {
      await window.lab.removeImage(projectImage);
      projectImage = previousImage;
      imageAdjustments = previousAdjustments;
      applyAdjustmentControls();
      await renderSavedImage();
      return;
    }
    if (previousImage) await window.lab.removeImage(previousImage);
  } catch (error) {
    console.error(error);
    projectImage = previousImage;
    imageAdjustments = previousAdjustments;
    applyAdjustmentControls();
    await renderSavedImage();
    status('Image import failed');
  }
}

async function removeSavedImage() {
  if (!projectImage) return;
  const previousImage = projectImage;
  const previousAdjustments = imageAdjustments;
  projectImage = null;
  imageAdjustments = { ...DEFAULT_ADJUSTMENTS };
  applyAdjustmentControls();
  clearImagePreview();
  changed();

  const saved = await save(false);
  if (saved) {
    await window.lab.removeImage(previousImage);
  } else {
    projectImage = previousImage;
    imageAdjustments = previousAdjustments;
    applyAdjustmentControls();
    await renderSavedImage();
  }
}

function adjustmentChanged() {
  imageAdjustments = readAdjustmentControls();
  updateAdjustmentOutputs();
  schedulePreparedRender();
  changed();
}

function rotateImage(amount) {
  imageAdjustments = normalizeAdjustments({
    ...readAdjustmentControls(),
    rotation: imageAdjustments.rotation + amount
  });
  applyAdjustmentControls();
  schedulePreparedRender();
  changed();
}

function resetAdjustments() {
  imageAdjustments = { ...DEFAULT_ADJUSTMENTS };
  applyAdjustmentControls();
  schedulePreparedRender();
  changed();
}

function heightMapChanged() {
  heightMapSettings = readHeightMapControls();
  applyHeightMapControls();
  reconcilePaletteRanges();
  renderPaletteRanges();
  scheduleHeightMapRender();
  schedulePaletteRender();
  changed();
}

function resetHeightMap() {
  heightMapSettings = { ...DEFAULT_HEIGHT_MAP };
  applyHeightMapControls();
  reconcilePaletteRanges();
  renderPaletteRanges();
  scheduleHeightMapRender();
  schedulePaletteRender();
  changed();
}

async function exportHeightMap() {
  const canvas = $('#heightMapCanvas');
  if (!sourceImage || canvas.width <= 1 || canvas.height <= 1) return;
  $('#heightExportStatus').textContent = 'Opening save dialog...';

  try {
    const result = await window.lab.exportHeightMap({
      projectName: $('#projectName').value,
      dataUrl: canvas.toDataURL('image/png')
    });
    $('#heightExportStatus').textContent = result?.canceled
      ? 'Export canceled.'
      : `Exported and verified: ${result.path}`;
  } catch (error) {
    console.error(error);
    $('#heightExportStatus').textContent = 'Height-map export failed.';
  }
}

async function exportSchedule() {
  $('#scheduleExportStatus').textContent = 'Opening save dialog...';
  try {
    const result = await window.lab.exportColorSchedule({
      projectName: $('#projectName').value,
      text: colorScheduleText()
    });
    $('#scheduleExportStatus').textContent = result?.canceled
      ? 'Export canceled.'
      : `Exported and verified: ${result.path}`;
  } catch (error) {
    console.error(error);
    $('#scheduleExportStatus').textContent = 'Schedule export failed.';
  }
}

function inventoryChanged() {
  reconcilePaletteRanges();
  renderPaletteWorkspace();
  changed();
}

$$('.nav').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$('#save').addEventListener('click', () => save(false));
$$('#projectName,#projectNotes,#layerHeight,#printWidth').forEach((input) => input.addEventListener('input', changed));
$('#addFilament').addEventListener('click', () => {
  $('#inventoryBody').append(inventoryRow());
  inventoryChanged();
});
$('#addLayer').addEventListener('click', () => {
  $('#layerList').append(layerRow());
  changed();
  summarize();
});
$('#removeImage').addEventListener('click', removeSavedImage);
$('#rotateLeft').addEventListener('click', () => rotateImage(-90));
$('#rotateRight').addEventListener('click', () => rotateImage(90));
$('#resetAdjustments').addEventListener('click', resetAdjustments);
$('#resetHeightMap').addEventListener('click', resetHeightMap);
$('#exportHeightMap').addEventListener('click', exportHeightMap);
$('#addPaletteRange').addEventListener('click', addPaletteRange);
$('#autoPalette').addEventListener('click', autoDistributePalette);
$('#exportSchedule').addEventListener('click', exportSchedule);
adjustmentIds.forEach((controlId) => $(`#${controlId}`).addEventListener('input', adjustmentChanged));
$('#grayscale').addEventListener('change', adjustmentChanged);
$$('#heightLayerCount,#heightLayerHeight,#heightMin,#heightMax').forEach((input) => input.addEventListener('change', heightMapChanged));
$('#heightInvert').addEventListener('change', heightMapChanged);
$('#imageInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  await importSelectedImage(file);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save(false);
  }
});

window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

Promise.all([window.lab.load(), window.lab.dataPath()]).then(async ([result, dataFilePath]) => {
  const data = result?.data ?? result;
  await fill(data);
  $('#dataPath').textContent = result?.path ?? dataFilePath;
  dirty = false;

  if (result?.recovered) {
    status('Recovered local data from backup', true);
  } else {
    status('Local data loaded', true);
  }
}).catch((error) => {
  console.error(error);
  status('Unable to load local data');
});
