const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Aseprite = require('ase-parser');
const FileMonitor = require('./file-monitor');

// 保持对窗口对象的全局引用
let mainWindow;
let currentFilePath = null;
let fileMonitor = null;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      // 安全设置 - 修复安全警告
      webSecurity: true,
      allowRunningInsecureContent: false,
      // 文件访问设置
      allowFileAccess: true,
      allowFileAccessFromFileURLs: false, // 修复安全警告
      allowUniversalAccessFromFileURLs: false, // 修复安全警告
      // 禁用不安全的功能
      experimentalFeatures: false,
      // 启用沙盒模式
      sandbox: false // 需要访问文件系统，所以设为 false
    },
    icon: path.join(__dirname, '../public/favicon.ico'),
    title: 'Aseprite 文件预览器',
    // 添加启动参数解决 GPU 缓存问题
    show: false // 先不显示，等加载完成后再显示
  });

  // 加载应用
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));
  }
  
  // 页面加载完成后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('窗口已显示');
  });

  // 当窗口被关闭时
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (fileMonitor) {
      fileMonitor.destroy();
      fileMonitor = null;
    }
  });

  // 启用文件拖拽
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(`
      // 启用文件拖拽
      document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      
      document.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          const file = files[0];
          if (file.path && file.path.endsWith('.aseprite')) {
            console.log('拖拽文件路径:', file.path);
            window.electronAPI.openFile(file.path);
          } else {
            console.log('文件类型不支持或路径无效:', file.name, file.path);
          }
        }
      });
    `);
  });
}

// 解析 Aseprite 文件
function parseAsepriteFile(filePath) {
  try {
    const buff = fs.readFileSync(filePath);
    const aseFile = new Aseprite(buff, path.basename(filePath));
    aseFile.parse();
    
    // 处理帧数据
    const processedFrames = aseFile.frames.map((frame, index) => {
      let frameWidth = aseFile.width;
      let frameHeight = aseFile.height;
      
      if (frame.cels && frame.cels.length > 0) {
        const firstCel = frame.cels[0];
        if (firstCel && firstCel.w && firstCel.h) {
          frameWidth = firstCel.w;
          frameHeight = firstCel.h;
        }
      }
      
      return {
        ...frame,
        width: frameWidth,
        height: frameHeight
      };
    });
    
    return {
      success: true,
      data: {
        frames: processedFrames,
        width: aseFile.width,
        height: aseFile.height,
        filename: path.basename(filePath),
        numFrames: aseFile.frames.length,
        colorDepth: aseFile.colorDepth || 32,
        pixelRatio: aseFile.pixelRatio || '1:1',
        layers: aseFile.layers || [],
        palette: aseFile.palette
      }
    };
  } catch (error) {
    console.error('解析文件失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 初始化文件监控器
function initializeFileMonitor() {
  if (fileMonitor) {
    fileMonitor.destroy();
  }
  
  fileMonitor = new FileMonitor({
    debounceDelay: 200,
    checkInterval: 1000,
    enableHashCheck: true,
    enableStatusReport: true,
    statusReportInterval: 30000
  });
  
  // 监听文件变化事件
  fileMonitor.on('fileChanged', async (data) => {
    console.log(`📝 Electron 检测到文件变化: ${data.filePath}`);
    
    try {
      const parseResult = parseAsepriteFile(data.filePath);
      if (parseResult.success) {
        // 确保窗口存在且未关闭
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-updated', {
            message: '文件已更新',
            data: parseResult.data,
            timestamp: data.timestamp,
            filePath: data.filePath
          });
          
          console.log('✅ Electron 已通知渲染进程更新预览');
          
          // 强制刷新渲染进程
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('force-refresh', {
                timestamp: new Date().toISOString()
              });
            }
          }, 50);
        }
      } else {
        console.error('❌ 文件解析失败:', parseResult.error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-update-error', {
            error: parseResult.error,
            timestamp: data.timestamp
          });
        }
      }
    } catch (error) {
      console.error('❌ Electron 文件解析失败:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-update-error', {
          error: error.message,
          timestamp: data.timestamp
        });
      }
    }
  });
  
  // 监听监控错误事件
  fileMonitor.on('watchError', (data) => {
    console.error('❌ Electron 文件监控错误:', data.error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-watch-error', {
        error: data.error,
        timestamp: data.timestamp
      });
    }
  });
  
  // 监听监控状态报告
  fileMonitor.on('statusReport', (data) => {
    console.log(`📊 Electron 监控状态: ${path.basename(data.filePath)} - 活跃`);
  });
}

// 启动文件监控
async function startFileWatching(filePath) {
  try {
    if (!fileMonitor) {
      initializeFileMonitor();
    }
    
    await fileMonitor.startWatching(filePath);
    console.log(`✅ Electron 文件监控已启动: ${path.basename(filePath)}`);
  } catch (error) {
    console.error('❌ 启动 Electron 文件监控失败:', error);
    throw error;
  }
}

// 停止文件监控
async function stopFileWatching() {
  if (fileMonitor) {
    await fileMonitor.stopWatching();
    console.log('⏹️ Electron 文件监控已停止');
  }
}

// IPC 事件处理
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    console.log('尝试打开文件:', filePath);
    
    if (!filePath) {
      throw new Error('文件路径为空');
    }
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    console.log('文件存在，开始解析...');
    const parseResult = parseAsepriteFile(filePath);
    if (parseResult.success) {
      currentFilePath = filePath;
      
      // 启动文件监控
      await startFileWatching(filePath);
      
    console.log('文件解析成功，帧数:', parseResult.data.frames.length);
    console.log('📊 图层数据结构:', parseResult.data.layers);
    
    return {
      success: true,
      message: '文件打开成功',
      data: parseResult.data,
      filePath: filePath
    };
    } else {
      console.error('文件解析失败:', parseResult.error);
      return {
        success: false,
        error: parseResult.error
      };
    }
  } catch (error) {
    console.error('打开文件时发生错误:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-current-file', () => {
  if (!currentFilePath || !fs.existsSync(currentFilePath)) {
    return {
      success: false,
      error: '没有打开的文件'
    };
  }

  const parseResult = parseAsepriteFile(currentFilePath);
  return parseResult;
});

// 启动文件监控
ipcMain.handle('startFileWatch', async (event, filePath) => {
  try {
    console.log('IPC: 启动文件监控:', filePath);
    await startFileWatching(filePath);
    return {
      success: true,
      message: '文件监控已启动'
    };
  } catch (error) {
    console.error('IPC: 启动文件监控失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 停止文件监控
ipcMain.handle('stopFileWatch', async () => {
  try {
    console.log('IPC: 停止文件监控');
    await stopFileWatching();
    return {
      success: true,
      message: '文件监控已停止'
    };
  } catch (error) {
    console.error('IPC: 停止文件监控失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 打开文件选择对话框
ipcMain.handle('open-file-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Aseprite 文件',
      filters: [
        { name: 'Aseprite 文件', extensions: ['aseprite'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      console.log('用户选择的文件:', filePath);
      return {
        success: true,
        filePath: filePath
      };
    } else {
      return {
        success: false,
        error: '用户取消了文件选择'
      };
    }
  } catch (error) {
    console.error('文件选择对话框错误:', error);
    return {
      success: false,
      error: error.message
    };
  }
});


// 应用事件
app.whenReady().then(() => {
  // 设置命令行参数解决 GPU 缓存问题
  app.commandLine.appendSwitch('--disable-gpu-sandbox');
  app.commandLine.appendSwitch('--disable-software-rasterizer');
  app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');
  app.commandLine.appendSwitch('--disable-background-timer-throttling');
  app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('--disable-renderer-backgrounding');
  
  console.log('应用启动参数已设置');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 优雅关闭
app.on('before-quit', async () => {
  if (fileMonitor) {
    await fileMonitor.destroy();
    fileMonitor = null;
  }
});
