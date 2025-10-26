# Aseprite 文件预览器

基于 Electron 和 Node.js 实现的 Aseprite 文件预览工具，支持实时文件监控和自动刷新。

## 核心功能

- 🎨 **文件预览**: 支持 .aseprite 文件的 Canvas 渲染预览
- 📁 **文件选择**: 支持点击选择和拖拽上传
- 👁️ **实时监控**: 使用 fs.watch 监控文件变化，通过 Electron IPC 通知前端刷新
- 🔄 **自动刷新**: 文件修改后自动更新预览

## 技术架构

### 核心文件
- `server.js` - Node.js 服务器，提供静态文件服务
- `start.js` - 应用启动脚本，同时启动服务器和 Electron
- `electron/main.js` - Electron 主进程，处理 IPC 通信
- `electron/preload.js` - Electron 预加载脚本，暴露安全 API
- `electron/file-monitor.js` - 文件监控模块
- `public/index.html` - 前端界面
- `public/ase-canvas-renderer.js` - Canvas 渲染器
- `public/unified-file-monitor.js` - 统一文件监控管理

### 工作流程
1. 启动项目 → Electron 窗口和 Node.js 服务器同时启动
2. 选择/拖入文件 → Electron IPC 获取文件路径并解析
3. Electron 主进程 fs.watch 监控文件变化
4. 文件变动 → 通过 IPC (ipcMain.send) 通知渲染进程刷新渲染

## 快速开始

### 安装依赖
```bash
npm install
```

### 启动应用
```bash
npm start
```

## 使用说明

1. 启动应用后，会同时打开 Electron 窗口和启动 Web 服务器
2. 若存在上次选择的文件，则自动加载并渲染预览
3. 点击"选择文件"按钮或直接拖拽 .aseprite 文件到界面
4. 文件会自动解析并在 Canvas 中渲染预览
5. 修改源文件后，预览会自动刷新

## 依赖说明
- `ase-parser` - Aseprite 文件解析
- `express` - Web 服务器
- `electron` - 桌面应用框架，提供 IPC 通信能力