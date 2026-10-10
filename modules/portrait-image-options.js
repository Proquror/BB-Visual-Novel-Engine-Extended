// Adapted from Comic Forge locally: portrait profiles default to square images
// and keep vendor-specific parameters away from existing compatible connections.
const OPENAI_IMAGE_QUALITIES = ['standard', 'hd', 'high', 'medium', 'low', 'auto'];
const VALID_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export const IMAGE_PARAMETER_MODES = ['compatible', 'gpt-image', 'gpt-image-2', 'gpt-image-2.5', 'grok'];
export const GROK_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2'];
export const IMAGE_ASPECT_RATIOS = [...new Set([...VALID_ASPECT_RATIOS, ...GROK_ASPECT_RATIOS])];

export function getImageParameterMode(settings) {
    return IMAGE_PARAMETER_MODES.includes(settings.parameterMode) ? settings.parameterMode : 'compatible';
}

export function getImageQualityOptions(settings) {
    const mode = getImageParameterMode(settings);
    if (mode === 'compatible') return ['', ...OPENAI_IMAGE_QUALITIES];
    if (mode === 'grok') return ['', 'auto', 'low', 'medium'];
    return mode === 'gpt-image-2.5' ? ['', 'auto', 'low', 'medium', 'high', 'xhigh', 'max'] : ['', 'auto', 'low', 'medium', 'high'];
}

export function normalizeImageParameterSettings(settings) {
    settings.parameterMode = getImageParameterMode(settings);
    if (!IMAGE_ASPECT_RATIOS.includes(settings.aspect) && settings.aspect !== 'auto') settings.aspect = '1:1';
    if (settings.parameterMode === 'grok' && !GROK_ASPECT_RATIOS.includes(settings.aspect)) settings.aspect = '1:1';
    settings.customSize = String(settings.customSize || '').trim().slice(0, 32);
    if (!getImageQualityOptions(settings).includes(settings.quality)) settings.quality = '';
    if (settings.type === 'openai-images' && settings.parameterMode === 'grok' && settings.imageSize === '4K') settings.imageSize = '2K';
    if (settings.parameterMode === 'gpt-image' && !['1024x1024', '1536x1024', '1024x1536', 'auto'].includes(settings.size)) settings.size = '1024x1024';
    return settings;
}

export function buildImageRequestOptions(settings, panel = {}) {
    const mode = getImageParameterMode(settings);
    const quality = settings.quality || '';
    if (!getImageQualityOptions(settings).includes(quality)) throw new Error(`Качество ${quality} не поддерживается режимом ${mode}. Проверьте настройки подключения.`);
    if (mode === 'compatible') return { size: settings.size || '1024x1024', ...(quality ? { quality } : {}) };
    if (mode === 'gpt-image') {
        const size = settings.size || '1024x1024';
        if (!['1024x1024', '1536x1024', '1024x1536', 'auto'].includes(size)) throw new Error('Некорректный размер GPT Image.');
        return { size, ...(quality ? { quality } : {}) };
    }
    const aspectRatio = settings.aspect && settings.aspect !== 'auto' ? settings.aspect : (panel.aspectRatio || '1:1');
    const resolution = settings.imageSize || '1K';
    if (mode === 'grok') {
        if (!['1K', '2K'].includes(resolution)) throw new Error('Grok поддерживает только разрешения 1K и 2K.');
        if (!GROK_ASPECT_RATIOS.includes(aspectRatio) && aspectRatio !== 'auto') throw new Error(`Grok не поддерживает пропорции ${aspectRatio}. Выберите пропорции в настройках подключения.`);
        return { resolution: resolution.toLowerCase(), aspect_ratio: aspectRatio, ...(quality ? { quality } : {}), response_format: 'b64_json' };
    }
    let size = String(settings.customSize || '').trim();
    if (!size) {
        const edge = { '1K': 1024, '2K': 2048, '4K': 3840 }[resolution];
        const [widthRatio, heightRatio] = String(aspectRatio === 'auto' ? '1:1' : aspectRatio).split(':').map(Number);
        if (!edge || !(widthRatio > 0 && heightRatio > 0)) throw new Error('Некорректное разрешение или пропорции GPT Image.');
        let scale = Math.max(edge / Math.max(widthRatio, heightRatio), Math.sqrt(655360 / (widthRatio * heightRatio)));
        let width = Math.round(widthRatio * scale / 16) * 16;
        let height = Math.round(heightRatio * scale / 16) * 16;
        if (width * height < 655360) {
            scale += 16 / Math.max(widthRatio, heightRatio);
            width = Math.round(widthRatio * scale / 16) * 16;
            height = Math.round(heightRatio * scale / 16) * 16;
        }
        size = `${width}x${height}`;
    }
    const match = /^(\d+)x(\d+)$/.exec(size);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    const pixels = width * height;
    if (!match || !width || !height || width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655360 || pixels > 8294400) {
        throw new Error(`Размер ${size} не поддерживается GPT Image: стороны кратны 16, до 3840 px, пропорции до 3:1, от 655360 до 8294400 пикселей. Выберите другое разрешение или точный размер.`);
    }
    return { size, ...(quality ? { quality } : {}) };
}
