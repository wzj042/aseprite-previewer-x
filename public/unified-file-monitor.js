/**
 * 统一文件监听管理器
 * 解决重复监听问题，提供单一监听入口
 */
class UnifiedFileMonitor extends EventTarget {
  constructor() {
    super();
    this.activeMonitors = new Map(); // 存储活跃的监听器
    this.monitorTypes = {
      ELECTRON: 'electron',
      SERVER: 'server', 
      POLLING: 'polling'
    };
    this.currentType = null;
    this.currentFilePath = null;
  }

  /**
   * 开始监听文件
   * @param {string} filePath - 文件路径
   * @param {string} preferredType - 首选监听类型
   */
  async startWatching(filePath, preferredType = null) {
    try {
      console.log(`🔄 统一文件监听管理器 - 开始监听: ${filePath}`);
      
      // 停止现有监听
      await this.stopAllWatching();
      
      // 确定监听类型
      const monitorType = this.determineMonitorType(preferredType);
      console.log(`📊 选择监听类型: ${monitorType}`);
      
      // 启动对应类型的监听
      switch (monitorType) {
        case this.monitorTypes.ELECTRON:
          await this.startElectronWatching(filePath);
          break;
        case this.monitorTypes.SERVER:
          await this.startServerWatching(filePath);
          break;
        case this.monitorTypes.POLLING:
          await this.startPollingWatching(filePath);
          break;
        default:
          throw new Error(`不支持的监听类型: ${monitorType}`);
      }
      
      this.currentType = monitorType;
      this.currentFilePath = filePath;
      
      // 触发监听启动事件
      this.dispatchEvent(new CustomEvent('monitorStarted', {
        detail: {
          type: monitorType,
          filePath: filePath,
          timestamp: new Date().toISOString()
        }
      }));
      
      console.log(`✅ 统一监听已启动: ${monitorType} -> ${filePath}`);
      
    } catch (error) {
      console.error('❌ 统一监听启动失败:', error);
      
      // 触发监听错误事件
      this.dispatchEvent(new CustomEvent('monitorError', {
        detail: {
          error: error.message,
          filePath: filePath,
          timestamp: new Date().toISOString()
        }
      }));
      
      throw error;
    }
  }

  /**
   * 确定监听类型
   * @param {string} preferredType - 首选类型
   * @returns {string} 实际使用的监听类型
   */
  determineMonitorType(preferredType) {
    // 优先级：Electron > Server > Polling
    
    if (preferredType && this.isMonitorTypeSupported(preferredType)) {
      return preferredType;
    }
    
    // 自动检测环境
    if (this.isElectronEnvironment()) {
      return this.monitorTypes.ELECTRON;
    } else if (this.isServerEnvironment()) {
      return this.monitorTypes.SERVER;
    } else {
      return this.monitorTypes.POLLING;
    }
  }

  /**
   * 检查监听类型是否支持
   */
  isMonitorTypeSupported(type) {
    return Object.values(this.monitorTypes).includes(type);
  }

  /**
   * 检查是否为 Electron 环境
   */
  isElectronEnvironment() {
    return typeof window !== 'undefined' && window.electronAPI;
  }

  /**
   * 检查是否为服务器环境
   */
  isServerEnvironment() {
    return typeof process !== 'undefined' && process.env.NODE_ENV;
  }

  /**
   * 启动 Electron 监听
   */
  async startElectronWatching(filePath) {
    console.log('🔗 启动 Electron 文件监听');
    
    if (!window.electronAPI) {
      throw new Error('Electron API 不可用');
    }
    
    // 通过 Electron API 启动监听
    const result = await window.electronAPI.startFileWatch(filePath);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    this.activeMonitors.set('electron', {
      type: 'electron',
      filePath: filePath,
      startTime: Date.now()
    });
  }

  /**
   * 启动服务器监听
   */
  async startServerWatching(filePath) {
    console.log('🖥️ 启动服务器文件监听');
    
    // 通过服务器 API 启动监听
    const response = await fetch('/api/start-file-watch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    this.activeMonitors.set('server', {
      type: 'server',
      filePath: filePath,
      startTime: Date.now()
    });
  }

  /**
   * 启动轮询监听
   */
  async startPollingWatching(filePath) {
    console.log('🔄 启动轮询文件监听');
    
    // 启动轮询监控
    if (window.fileManager && typeof window.fileManager.startPollingMonitor === 'function') {
      window.fileManager.startPollingMonitor(filePath);
      
      this.activeMonitors.set('polling', {
        type: 'polling',
        filePath: filePath,
        startTime: Date.now()
      });
    } else {
      throw new Error('文件管理器不可用');
    }
  }

  /**
   * 停止所有监听
   */
  async stopAllWatching() {
    console.log('⏹️ 停止所有文件监听');
    
    const stopPromises = [];
    
    for (const [key, monitor] of this.activeMonitors) {
      stopPromises.push(this.stopSpecificWatching(key, monitor));
    }
    
    await Promise.allSettled(stopPromises);
    
    this.activeMonitors.clear();
    this.currentType = null;
    this.currentFilePath = null;
    
    // 触发监听停止事件
    this.dispatchEvent(new CustomEvent('monitorStopped', {
      detail: {
        timestamp: new Date().toISOString()
      }
    }));
    
    console.log('✅ 所有监听已停止');
  }

  /**
   * 停止特定类型的监听
   */
  async stopSpecificWatching(key, monitor) {
    try {
      switch (monitor.type) {
        case this.monitorTypes.ELECTRON:
          if (window.electronAPI) {
            await window.electronAPI.stopFileWatch();
          }
          break;
        case this.monitorTypes.SERVER:
          await fetch('/api/stop-file-watch', { method: 'POST' });
          break;
        case this.monitorTypes.POLLING:
          if (window.fileManager) {
            window.fileManager.stopPollingMonitor();
          }
          break;
      }
      
      console.log(`✅ ${monitor.type} 监听已停止`);
      
    } catch (error) {
      console.error(`❌ 停止 ${monitor.type} 监听失败:`, error);
    }
  }

  /**
   * 获取当前监听状态
   */
  getStatus() {
    return {
      currentType: this.currentType,
      currentFilePath: this.currentFilePath,
      activeMonitors: Array.from(this.activeMonitors.values()),
      monitorCount: this.activeMonitors.size
    };
  }

  /**
   * 检查是否有重复监听
   */
  hasDuplicateMonitoring() {
    return this.activeMonitors.size > 1;
  }

  /**
   * 切换监听类型
   */
  async switchMonitorType(newType) {
    if (!this.currentFilePath) {
      throw new Error('没有正在监听的文件');
    }
    
    console.log(`🔄 切换监听类型: ${this.currentType} -> ${newType}`);
    
    const currentFilePath = this.currentFilePath;
    await this.stopAllWatching();
    await this.startWatching(currentFilePath, newType);
  }
}

// 导出统一监听管理器
if (typeof window !== 'undefined') {
  window.UnifiedFileMonitor = UnifiedFileMonitor;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnifiedFileMonitor;
}
