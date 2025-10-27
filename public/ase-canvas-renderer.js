/**
 * 基于 Canvas 2D 的 Aseprite 文件渲染器
 * 参考 ase-web-viewer 的渲染方案，使用原生 JavaScript 实现
 */

class AseCanvasRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.inMemCanvas = document.createElement('canvas');
        this.inMemCtx = this.inMemCanvas.getContext('2d');
        
        // 变换状态
        this.trans = { x: 0, y: 0 };
        this.scale = 1.0;
        this.scaleMultiplier = 1.1;
        
        // 拖拽状态
        this.dragStart = null;
        this.dragged = false;
        
        // 文件数据
        this.aseData = null;
        this.currentFrame = 0;
        this.lastRenderTime = 0;
        this.isFlipped = false; // 水平翻转状态
        
        // 图层控制状态
        this.layerVisibility = new Map(); // 存储图层可见性状态
        
        this.initCanvas();
        this.setupEventListeners();
    }
    
    initCanvas() {
        // 设置主画布尺寸
        this.canvas.width = 240;
        this.canvas.height = 240;
        this.trans.x = 120;
        this.trans.y = 120;
        
        // 设置像素完美渲染
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;
        
        // 初始化变换跟踪
        this.trackTransforms(this.ctx);
    }
    
    setupEventListeners() {
        // 鼠标滚轮缩放
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY ? e.deltaY / 40 : 0;
            if (delta) {
                this.zoom(delta);
            }
        });
        
        // 鼠标拖拽
        this.canvas.addEventListener('mousedown', (e) => {
            this.trans.x = e.offsetX || (e.pageX - this.canvas.offsetLeft);
            this.trans.y = e.offsetY || (e.pageY - this.canvas.offsetTop);
            this.dragStart = this.ctx.transformedPoint(this.trans.x, this.trans.y);
            this.dragged = false;
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.dragStart !== null && this.dragStart !== undefined) {
                this.trans.x = e.offsetX || (e.pageX - this.canvas.offsetLeft);
                this.trans.y = e.offsetY || (e.pageY - this.canvas.offsetTop);
                this.dragged = true;
                const pt = this.ctx.transformedPoint(this.trans.x, this.trans.y);
                this.ctx.translate(pt.x - this.dragStart.x, pt.y - this.dragStart.y);
                this.swapDraw();
            }
        });
        
        this.canvas.addEventListener('mouseup', (e) => {
            if (!this.dragged) {
                this.zoom(e.shiftKey ? -1 : 1);
            }
            this.dragStart = null;
        });
    }
    
    /**
     * 加载并解析 Aseprite 文件
     */
    async loadAseFile(file) {
        return new Promise((resolve, reject) => {
            console.log(`📁 开始加载文件: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            const loadStartTime = performance.now();
            
            const fr = new FileReader();
            fr.onload = async (e) => {
                try {
                    const loadEndTime = performance.now();
                    const loadTime = (loadEndTime - loadStartTime).toFixed(2);
                    console.log(`📖 文件读取完成，耗时: ${loadTime}ms`);
                    
                    const aseReader = new AseReader(e.target.result, file.name);
                    aseReader.parse();
                    this.aseData = aseReader;
                    this.currentFrame = 0;
                    
                    console.log(`🎯 文件解析完成，开始渲染第一帧`);
                    this.renderFrame(0);
                    
                    resolve(aseReader);
                } catch (error) {
                    console.error(`❌ 文件解析失败:`, error);
                    reject(error);
                }
            };
            fr.onerror = () => {
                console.error(`❌ 文件读取失败`);
                reject(new Error('文件读取失败'));
            };
            fr.readAsArrayBuffer(file);
        });
    }
    
    /**
     * 渲染指定帧
     */
    renderFrame(frameIndex) {
        if (!this.aseData || !this.aseData.frames[frameIndex]) {
            console.warn('❌ 无效的帧索引或数据:', {
                frameIndex: frameIndex,
                framesLength: this.aseData?.frames?.length,
                availableFrames: this.aseData?.frames?.map((f, i) => i)
            });
            return;
        }
        
        // 避免过于频繁的渲染 - 优化频率限制
        const now = Date.now();
        if (now - this.lastRenderTime < 100) { // 100ms间隔限制
            // 减少日志输出，只在调试模式下显示
            if (window.DEBUG_RENDERER) {
                console.log('渲染被频率限制过滤');
            }
            return;
        }
        this.lastRenderTime = now;
        
        const renderStartTime = performance.now();
        this.currentFrame = frameIndex;
        this.clearCanvas();
        
        // 确保像素完美渲染设置
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;
        
        const frame = this.aseData.frames[frameIndex];
        const celLen = frame.cels.length;
        
        
        // 先应用缩放和居中变换（包含翻转逻辑）
        this.fitToContainer();
        
        // 渲染所有可见的 Cel（只渲染启用的图层）
        for (let i = 0; i < celLen; i++) {
            const celData = frame.cels[i];
            const layerIndex = celData.layerIndex;
            
            // 检查图层是否可见
            if (this.isLayerVisible(layerIndex)) {
                this.writeCel(i);
            }
        }
        
        // 强制重绘，确保渲染完成
        this.ctx.save();
        this.ctx.restore();
        
        const renderEndTime = performance.now();
        const renderTime = (renderEndTime - renderStartTime).toFixed(2);
    }
    
    /**
     * 检查图层是否可见
     * @param {number} layerIndex - 图层索引
     * @returns {boolean} - 图层是否可见
     */
    isLayerVisible(layerIndex) {
        if (!this.aseData || !this.aseData.layers || !this.aseData.layers[layerIndex]) {
            // 如果没有图层信息，默认可见
            return true;
        }
        
        // 首先检查用户自定义的可见性设置
        if (this.layerVisibility.has(layerIndex)) {
            return this.layerVisibility.get(layerIndex);
        }
        
        const layer = this.aseData.layers[layerIndex];
        
        // 检查图层标志位
        let isVisible;
        
        if (typeof layer.flags === 'object' && layer.flags !== null) {
            // flags 是对象的情况（ase-parser 库解析后的格式）
            isVisible = layer.flags.visible === true;
            console.log(`🔍 图层 ${layerIndex} (${layer.name}) 对象flags:`, {
                flags: layer.flags,
                visible: layer.flags.visible,
                isVisible: isVisible
            });
        } else if (typeof layer.flags === 'number') {
            // flags 是数字的情况（原始格式）
            // flags 的第0位表示图层是否可见 (1 = 可见, 0 = 隐藏)
            isVisible = (layer.flags & 0x01) === 1;
            console.log(`🔍 图层 ${layerIndex} (${layer.name}) 数字flags:`, {
                flags: layer.flags,
                flagsBinary: layer.flags.toString(2),
                bit0: layer.flags & 0x01,
                isVisible: isVisible
            });
        } else {
            // 未知格式，默认可见
            console.warn(`⚠️ 图层 ${layerIndex} flags 格式未知:`, layer.flags);
            isVisible = true;
        }
        
        return isVisible;
    }
    
    /**
     * 设置图层可见性
     * @param {number} layerIndex - 图层索引
     * @param {boolean} visible - 是否可见
     */
    setLayerVisibility(layerIndex, visible) {
        this.layerVisibility.set(layerIndex, visible);
        console.log(`🎨 图层 ${layerIndex} 可见性设置为: ${visible ? '可见' : '隐藏'}`);
        
        // 重新渲染当前帧以应用更改
        if (this.aseData) {
            this.renderFrame(this.currentFrame);
        }
    }
    
    /**
     * 切换图层可见性
     * @param {number} layerIndex - 图层索引
     * @returns {boolean} - 新的可见性状态
     */
    toggleLayerVisibility(layerIndex) {
        const currentVisible = this.isLayerVisible(layerIndex);
        const newVisible = !currentVisible;
        this.setLayerVisibility(layerIndex, newVisible);
        return newVisible;
    }
    
    /**
     * 获取所有图层信息
     * @returns {Array} - 图层信息数组
     */
    getAllLayers() {
        if (!this.aseData || !this.aseData.layers) {
            return [];
        }
        
        // 倒序处理图层，使最上层图层显示在列表顶部
        const layers = this.aseData.layers.map((layer, index) => {
            const visible = this.isLayerVisible(index);
            
            return {
                index: index,
                name: layer.name || `图层 ${index + 1}`,
                visible: visible,
                flags: layer.flags,
                type: layer.type,
                opacity: layer.opacity,
                blendMode: layer.blendMode
            };
        }).reverse(); // 倒序处理
        
        console.log('📊 最终图层列表:', layers);
        return layers;
    }
    
    /**
     * 获取图层数量
     * @returns {number} - 图层数量
     */
    getLayerCount() {
        if (!this.aseData || !this.aseData.layers) {
            return 0;
        }
        return this.aseData.layers.length;
    }
    
    /**
     * 显示所有图层
     */
    showAllLayers() {
        if (!this.aseData || !this.aseData.layers) {
            return;
        }
        
        for (let i = 0; i < this.aseData.layers.length; i++) {
            this.layerVisibility.set(i, true);
        }
        
        console.log('🎨 显示所有图层');
        
        // 重新渲染当前帧
        if (this.aseData) {
            this.renderFrame(this.currentFrame);
        }
    }
    
    /**
     * 隐藏所有图层
     */
    hideAllLayers() {
        if (!this.aseData || !this.aseData.layers) {
            return;
        }
        
        for (let i = 0; i < this.aseData.layers.length; i++) {
            this.layerVisibility.set(i, false);
        }
        
        console.log('🎨 隐藏所有图层');
        
        // 重新渲染当前帧
        if (this.aseData) {
            this.renderFrame(this.currentFrame);
        }
    }
    
    /**
     * 获取 Cel 数据（处理链接帧）
     */
    getCelData(lFrame, numCel) {
        let currCel = this.aseData.frames[lFrame].cels[numCel];
        if (currCel.linkedFrame !== undefined) {
            let nextLFrame = currCel.linkedFrame;
            let nextCel = currCel;
            while (nextCel.celType === 1) {
                currCel = nextCel;
                nextLFrame = currCel.linkedFrame;
                nextCel = this.aseData.frames[nextLFrame].cels[numCel];
            }
            return { h: nextCel.h, w: nextCel.w, rawCelData: nextCel.rawCelData };
        } else {
            return { h: currCel.h, w: currCel.w, rawCelData: currCel.rawCelData };
        }
    }
    
    /**
     * 写入 Cel 到画布
     */
    writeCel(numCel) {
        const celData = this.aseData.frames[this.currentFrame].cels[numCel];
        const cel = celData.celType !== 1 ? celData : { 
            ...this.getCelData(celData.linkedFrame, numCel), 
            ...celData 
        };
        
        const colorDepth = this.aseData.colorDepth || 32; // 默认32位
        
        // 检查数据完整性
        if (!cel.rawCelData || cel.rawCelData.length === 0) {
            console.warn(`⚠️ Cel ${numCel} 没有像素数据`);
            return;
        }
        
        // 检查 Cel 尺寸
        if (!cel.w || !cel.h || cel.w <= 0 || cel.h <= 0) {
            console.warn(`⚠️ Cel ${numCel} 尺寸无效: ${cel.w}x${cel.h}`);
            return;
        }
        
        // 创建临时画布用于这个 Cel
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = cel.w;
        tempCanvas.height = cel.h;
        
        // 设置临时画布的像素完美渲染
        tempCtx.imageSmoothingEnabled = false;
        tempCtx.webkitImageSmoothingEnabled = false;
        tempCtx.mozImageSmoothingEnabled = false;
        tempCtx.msImageSmoothingEnabled = false;
        
        let imageData = tempCtx.createImageData(cel.w, cel.h);
        
        try {
            if (colorDepth === 32) { // sRGB - 修复像素数据复制逻辑
                const expectedLength = cel.w * cel.h * 4; // RGBA 每像素4字节
                const actualLength = cel.rawCelData.byteLength;
                
                console.log(`🎨 渲染 Cel ${numCel}: ${cel.w}x${cel.h}, 期望 ${expectedLength} 字节, 实际 ${actualLength} 字节`);
                
                if (actualLength >= expectedLength) {
                    // 直接复制像素数据
                    for (let i = 0; i < expectedLength; i++) {
                        imageData.data[i] = cel.rawCelData[i];
                    }
                } else {
                    console.warn(`⚠️ Cel ${numCel} 数据长度不足，尝试填充`);
                    // 数据不足时，尝试填充或截断
                    for (let i = 0; i < Math.min(expectedLength, actualLength); i++) {
                        imageData.data[i] = cel.rawCelData[i];
                    }
                }
            } else if (colorDepth === 16) { // 灰度 - 修复索引计算
                const pixelCount = cel.w * cel.h;
                for (let i = 0; i < pixelCount; i++) {
                    const dataIndex = i * 2; // 每像素2字节
                    if (dataIndex + 1 < cel.rawCelData.length) {
                        const value = cel.rawCelData[dataIndex];
                        const alpha = cel.rawCelData[dataIndex + 1];
                        
                        const pixelIndex = i * 4;
                        imageData.data[pixelIndex] = value;     // R
                        imageData.data[pixelIndex + 1] = value; // G
                        imageData.data[pixelIndex + 2] = value; // B
                        imageData.data[pixelIndex + 3] = alpha;  // A
                    }
                }
            } else if (colorDepth === 8) { // 索引色 - 修复调色板访问
                const pixelCount = cel.w * cel.h;
                for (let i = 0; i < pixelCount; i++) {
                    if (i < cel.rawCelData.length) {
                        const paletteIndex = cel.rawCelData[i];
                        const pixelIndex = i * 4;
                        
                        if (this.aseData.palette && this.aseData.palette.colors && this.aseData.palette.colors[paletteIndex]) {
                            const color = this.aseData.palette.colors[paletteIndex];
                            imageData.data[pixelIndex] = color.red;     // R
                            imageData.data[pixelIndex + 1] = color.green; // G
                            imageData.data[pixelIndex + 2] = color.blue;  // B
                            imageData.data[pixelIndex + 3] = color.alpha; // A
                        } else {
                            // 默认透明
                            imageData.data[pixelIndex] = 0;     // R
                            imageData.data[pixelIndex + 1] = 0; // G
                            imageData.data[pixelIndex + 2] = 0; // B
                            imageData.data[pixelIndex + 3] = 0; // A
                        }
                    }
                }
            }
            
            // 将像素数据放到临时画布
            tempCtx.putImageData(imageData, 0, 0);
            
            // 将临时画布的内容绘制到主画布的正确位置（正常绘制）
            this.ctx.drawImage(tempCanvas, cel.xpos, cel.ypos);
            
            console.log(`✅ Cel ${numCel} 渲染完成: 位置(${cel.xpos}, ${cel.ypos}), 尺寸(${cel.w}x${cel.h})`);
        } catch (error) {
            console.error(`❌ 渲染 Cel ${numCel} 失败:`, error);
            console.error('Cel 数据:', {
                w: cel.w,
                h: cel.h,
                xpos: cel.xpos,
                ypos: cel.ypos,
                dataLength: cel.rawCelData ? cel.rawCelData.length : 0,
                colorDepth: colorDepth
            });
        }
    }
    
    /**
     * 清除主画布
     */
    clearCanvas() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }
    
    /**
     * 清除内存画布
     */
    clearInMemCanvas() {
        if (this.aseData) {
            this.inMemCtx.clearRect(0, 0, this.aseData.width, this.aseData.height);
        }
    }
    
    /**
     * 缩放功能
     */
    zoom(clicks) {
        const pt = this.ctx.transformedPoint(this.trans.x, this.trans.y);
        this.ctx.translate(pt.x, pt.y);
        const factor = Math.pow(this.scaleMultiplier, clicks);
        this.ctx.scale(factor, factor);
        this.ctx.translate(-pt.x, -pt.y);
        this.swapDraw();
    }
    
    /**
     * 重新绘制
     */
    swapDraw() {
        // 确保像素完美渲染
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;
        
        this.ctx.scale(this.scale, this.scale);
        this.renderFrame(this.currentFrame);
    }
    
    /**
     * 变换跟踪功能（从 ase-web-viewer 移植）
     */
    trackTransforms(ctx) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
        var xform = svg.createSVGMatrix();
        ctx.getTransform = function() { return xform; };

        var savedTransforms = [];
        var save = ctx.save;
        ctx.save = function() {
            savedTransforms.push(xform.translate(0, 0));
            return save.call(ctx);
        };

        var restore = ctx.restore;
        ctx.restore = function() {
            xform = savedTransforms.pop();
            return restore.call(ctx);
        };

        var scale = ctx.scale;
        ctx.scale = function(sx, sy) {
            xform = xform.scaleNonUniform(sx, sy);
            return scale.call(ctx, sx, sy);
        };

        var rotate = ctx.rotate;
        ctx.rotate = function(radians) {
            xform = xform.rotate(radians * 180 / Math.PI);
            return rotate.call(ctx, radians);
        };

        var translate = ctx.translate;
        ctx.translate = function(dx, dy) {
            xform = xform.translate(dx, dy);
            return translate.call(ctx, dx, dy);
        };

        var transform = ctx.transform;
        ctx.transform = function(a, b, c, d, e, f) {
            var m2 = svg.createSVGMatrix();
            m2.a = a; m2.b = b; m2.c = c; m2.d = d; m2.e = e; m2.f = f;
            xform = xform.multiply(m2);
            return transform.call(ctx, a, b, c, d, e, f);
        };

        var setTransform = ctx.setTransform;
        ctx.setTransform = function(a, b, c, d, e, f) {
            xform.a = a;
            xform.b = b;
            xform.c = c;
            xform.d = d;
            xform.e = e;
            xform.f = f;
            return setTransform.call(ctx, a, b, c, d, e, f);
        };

        var pt = svg.createSVGPoint();
        ctx.transformedPoint = function(x, y) {
            pt.x = x; pt.y = y;
            return pt.matrixTransform(xform.inverse());
        }
    }
    
    /**
     * 获取文件信息
     */
    getFileInfo() {
        if (!this.aseData) {
            console.warn('⚠️ getFileInfo: aseData 为空');
            return null;
        }
        
        const numLayers = this.getLayerCount();
        const layers = this.getAllLayers();
        
        console.log('📊 getFileInfo - 图层数量:', numLayers);
        console.log('📊 getFileInfo - 图层列表:', layers);
        
        return {
            name: this.aseData.name || this.aseData.filename || '未知文件',
            width: this.aseData.width || 0,
            height: this.aseData.height || 0,
            numFrames: this.aseData.numFrames || (this.aseData.frames ? this.aseData.frames.length : 0),
            colorDepth: this.aseData.colorDepth || 32, // 默认32位
            fileSize: this.aseData.fileSize || 0,
            pixelRatio: this.aseData.pixelRatio || '1:1',
            numLayers: numLayers,
            layers: layers
        };
    }
    
    /**
     * 切换到下一帧
     */
    nextFrame() {
        if (!this.aseData) return false;
        
        const frameCount = this.aseData.numFrames || (this.aseData.frames ? this.aseData.frames.length : 0);
        if (this.currentFrame < frameCount - 1) {
            this.renderFrame(this.currentFrame + 1);
            return true;
        }
        return false;
    }
    
    /**
     * 切换到上一帧
     */
    prevFrame() {
        if (!this.aseData) return false;
        
        if (this.currentFrame > 0) {
            this.renderFrame(this.currentFrame - 1);
            return true;
        }
        return false;
    }
    
    /**
     * 循环播放到下一帧（用于动画播放）
     */
    nextFrameLoop() {
        if (!this.aseData) return false;
        
        const frameCount = this.aseData.numFrames || (this.aseData.frames ? this.aseData.frames.length : 0);
        if (frameCount <= 0) return false;
        
        const nextFrame = (this.currentFrame + 1) % frameCount;
        this.renderFrame(nextFrame);
        return true;
    }
    
    /**
     * 获取当前帧的持续时间（毫秒）
     */
    getCurrentFrameDuration() {
        if (!this.aseData || !this.aseData.frames || !this.aseData.frames[this.currentFrame]) {
            return 100; // 默认100ms
        }
        
        const frameData = this.aseData.frames[this.currentFrame];
        return frameData.frameDuration || 100;
    }
    
    /**
     * 检查是否有多帧（可用于动画）
     */
    hasMultipleFrames() {
        if (!this.aseData) return false;
        
        // 优先使用 numFrames，如果不存在则使用 frames.length
        const frameCount = this.aseData.numFrames || (this.aseData.frames ? this.aseData.frames.length : 0);
        const result = frameCount > 1;
        
        // 只在调试模式下输出详细信息
        if (window.DEBUG_RENDERER) {
            console.log('🔍 检查多帧状态:', {
                hasAseData: !!this.aseData,
                numFrames: this.aseData?.numFrames,
                framesLength: this.aseData?.frames?.length,
                frameCount: frameCount,
                result: result
            });
        }
        return result;
    }
    
    /**
     * 切换水平翻转状态
     */
    toggleFlip() {
        this.isFlipped = !this.isFlipped;
        console.log(`🔄 水平翻转状态: ${this.isFlipped ? '已翻转' : '正常'}`);
        
        // 重新渲染当前帧以应用翻转
        if (this.aseData) {
            this.renderFrame(this.currentFrame);
        }
        
        return this.isFlipped;
    }
    
    /**
     * 设置水平翻转状态
     */
    setFlip(flipped) {
        this.isFlipped = flipped;
        console.log(`🔄 设置水平翻转状态: ${this.isFlipped ? '已翻转' : '正常'}`);
        
        // 重新渲染当前帧以应用翻转
        if (this.aseData) {
            this.renderFrame(this.currentFrame);
        }
    }
    
    /**
     * 自动适应容器大小
     */
    fitToContainer() {
        if (!this.aseData) return;
        
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const imageWidth = this.aseData.width;
        const imageHeight = this.aseData.height;
        
        // 计算缩放比例，使图像适应画布
        const scaleX = canvasWidth / imageWidth;
        const scaleY = canvasHeight / imageHeight;
        const scale = Math.min(scaleX, scaleY) * 0.9; // 留一些边距
        
        // 计算居中位置
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        
        // 重置变换
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // 确保像素完美渲染
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;
        
        // 应用缩放和居中
        this.ctx.translate(centerX, centerY);
        this.ctx.scale(scale, scale);
        this.ctx.translate(-imageWidth / 2, -imageHeight / 2);
        
        // 如果启用水平翻转，在缩放和居中之后应用翻转
        if (this.isFlipped) {
            this.ctx.scale(-1, 1);
            this.ctx.translate(-imageWidth, 0);
        }
        
        // 更新变换状态
        this.trans.x = centerX;
        this.trans.y = centerY;
        this.scale = scale;
    }
    
    /**
     * 重置视图
     */
    resetView() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.trans.x = 400;
        this.trans.y = 300;
        this.scale = 1.0;
        if (this.aseData) {
            // 直接重新渲染，避免循环调用
            this.clearCanvas();
            this.fitToContainer();
            
            const frame = this.aseData.frames[this.currentFrame];
            const celLen = frame.cels.length;
            for (let i = 0; i < celLen; i++) {
                const celData = frame.cels[i];
                const layerIndex = celData.layerIndex;
                
                // 检查图层是否可见
                if (this.isLayerVisible(layerIndex)) {
                    this.writeCel(i);
                }
            }
        }
    }
    
    /**
     * 强制刷新渲染
     */
    forceRefresh() {
        if (this.aseData) {
            console.log(`🔄 执行强制刷新，当前帧: ${this.currentFrame}`);
            
            // 清除所有缓存
            this.clearCanvas();
            this.clearInMemCanvas();
            
            // 重置渲染时间戳，绕过频率限制
            this.lastRenderTime = 0;
            
            // 强制重新渲染
            this.forceRender(this.currentFrame);
            
            console.log(`✅ 强制刷新完成`);
        }
    }
    
    /**
     * 强制渲染（绕过频率限制）
     */
    forceRender(frameIndex) {
        if (!this.aseData || !this.aseData.frames[frameIndex]) {
            console.warn('❌ 强制渲染失败: 无效的帧索引或数据');
            return;
        }
        
        console.log(`🔄 强制渲染帧 ${frameIndex}`);
        this.currentFrame = frameIndex;
        this.clearCanvas();
        
        // 确保像素完美渲染设置
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;
        
        const frame = this.aseData.frames[frameIndex];
        const celLen = frame.cels.length;
        
        // 先应用缩放和居中变换（包含翻转逻辑）
        this.fitToContainer();
        
        // 渲染所有可见的 Cel（只渲染启用的图层）
        for (let i = 0; i < celLen; i++) {
            const celData = frame.cels[i];
            const layerIndex = celData.layerIndex;
            
            // 检查图层是否可见
            if (this.isLayerVisible(layerIndex)) {
                this.writeCel(i);
            }
        }
        
        // 强制重绘，确保渲染完成
        this.ctx.save();
        this.ctx.restore();
        
        console.log(`✅ 强制渲染完成: 帧 ${frameIndex}`);
    }
    
    /**
     * 检查是否需要重新渲染
     */
    needsRefresh() {
        // 只在有数据且当前帧存在时返回 true
        // 避免不必要的渲染
        return this.aseData && this.aseData.frames && this.aseData.frames[this.currentFrame];
    }
    
    /**
     * 检查文件变动
     */
    checkFileChange(newFile) {
        if (!this.aseData || !newFile) {
            return { changed: false, reason: '无数据比较' };
        }
        
        const oldSize = this.aseData.fileSize || 0;
        const newSize = newFile.size;
        const sizeDiff = newSize - oldSize;
        
        console.log(`🔍 文件变动检查:`);
        console.log(`   旧文件大小: ${(oldSize / 1024).toFixed(1)} KB`);
        console.log(`   新文件大小: ${(newSize / 1024).toFixed(1)} KB`);
        console.log(`   大小差异: ${sizeDiff > 0 ? '+' : ''}${(sizeDiff / 1024).toFixed(1)} KB`);
        
        if (sizeDiff !== 0) {
            return { 
                changed: true, 
                reason: `文件大小变化: ${sizeDiff > 0 ? '增加' : '减少'} ${Math.abs(sizeDiff)} 字节`,
                sizeDiff: sizeDiff
            };
        }
        
        return { changed: false, reason: '文件大小未变化' };
    }
    
    /**
     * 更新文件数据
     */
    updateFileData(newAseData) {
        if (!newAseData) {
            console.warn('⚠️ 更新文件数据失败: 新数据为空');
            return;
        }
        
        console.log(`🔄 更新文件数据:`);
        console.log(`   旧帧数: ${this.aseData?.numFrames || 0}`);
        console.log(`   新帧数: ${newAseData.numFrames || 0}`);
        console.log(`   旧尺寸: ${this.aseData?.width || 0}x${this.aseData?.height || 0}`);
        console.log(`   新尺寸: ${newAseData.width || 0}x${newAseData.height || 0}`);
        
        // 保存当前帧索引，如果新数据中还有该帧则保持
        const oldCurrentFrame = this.currentFrame;
        const maxFrame = (newAseData.numFrames || newAseData.frames?.length || 1) - 1;
        
        this.aseData = newAseData;
        
        // 确保当前帧索引有效
        if (oldCurrentFrame > maxFrame) {
            this.currentFrame = 0;
        } else {
            this.currentFrame = oldCurrentFrame;
        }
        
        console.log(`✅ 文件数据更新完成，重新渲染帧 ${this.currentFrame}`);
        
        // 强制刷新渲染，绕过频率限制
        this.forceRender(this.currentFrame);
        
        // 更新画布尺寸适应
        setTimeout(() => {
            this.fitToContainer();
            this.forceRender(this.currentFrame);
        }, 50);
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AseCanvasRenderer;
} else {
    window.AseCanvasRenderer = AseCanvasRenderer;
}
