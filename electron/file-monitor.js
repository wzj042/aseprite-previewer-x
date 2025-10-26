const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * 统一文件监听管理器
 * 支持 Electron 和 Web 环境的文件监控
 */
class FileMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      debounceDelay: 200,
      checkInterval: 1000,
      enableHashCheck: true,
      enableStatusReport: true,
      statusReportInterval: 30000,
      ...options
    };
    
    this.currentFile = null;
    this.fileWatcher = null;
    this.lastModified = null;
    this.lastHash = null;
    this.isProcessing = false;
    this.statusInterval = null;
    this.checkInterval = null;
    
    // 绑定方法
    this.handleFileChange = this.handleFileChange.bind(this);
    this.handleWatcherError = this.handleWatcherError.bind(this);
    this.handleWatcherClose = this.handleWatcherClose.bind(this);
  }

  /**
   * 开始监控文件
   * @param {string} filePath - 文件路径
   * @param {Object} options - 监控选项
   */
  async startWatching(filePath, options = {}) {
    const watchOptions = { ...this.options, ...options };
    
    try {
      console.log(`📁 开始监控文件: ${filePath}`);
      
      // 验证文件存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      // 停止之前的监控
      await this.stopWatching();
      
      // 设置当前文件
      this.currentFile = filePath;
      
      // 初始化文件状态
      await this.initializeFileState(filePath);
      
      // 启动文件监控
      this.startFileWatcher(filePath, watchOptions);
      
      // 启动状态报告
      if (watchOptions.enableStatusReport) {
        this.startStatusReport();
      }
      
      // 发送监控开始事件
      this.emit('watchStarted', {
        filePath: filePath,
        timestamp: new Date().toISOString(),
        fileInfo: await this.getFileInfo(filePath)
      });
      
      console.log(`✅ 文件监控已启动: ${path.basename(filePath)}`);
      
    } catch (error) {
      console.error(`❌ 启动文件监控失败:`, error);
      this.emit('watchError', {
        error: error.message,
        filePath: filePath,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * 停止监控
   */
  async stopWatching() {
    if (this.fileWatcher) {
      console.log('🔄 停止文件监控');
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    this.currentFile = null;
    this.lastModified = null;
    this.lastHash = null;
    this.isProcessing = false;
    
    this.emit('watchStopped', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 初始化文件状态
   * @param {string} filePath - 文件路径
   */
  async initializeFileState(filePath) {
    try {
      const stats = fs.statSync(filePath);
      this.lastModified = stats.mtime.getTime();
      
      if (this.options.enableHashCheck) {
        const fileBuffer = fs.readFileSync(filePath);
        this.lastHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
        console.log(`📊 文件初始哈希: ${this.lastHash.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error('❌ 初始化文件状态失败:', error);
      throw error;
    }
  }

  /**
   * 启动文件监控器
   * @param {string} filePath - 文件路径
   * @param {Object} options - 监控选项
   */
  startFileWatcher(filePath, options) {
    this.fileWatcher = fs.watch(filePath, { persistent: true }, this.handleFileChange);
    this.fileWatcher.on('error', this.handleWatcherError);
    this.fileWatcher.on('close', this.handleWatcherClose);
    
    // 启动定期检查（作为 fs.watch 的补充）
    if (options.checkInterval > 0) {
      this.checkInterval = setInterval(() => {
        this.checkFileManually(filePath);
      }, options.checkInterval);
    }
  }

  /**
   * 处理文件变化事件
   * @param {string} eventType - 事件类型
   * @param {string} filename - 文件名
   */
  async handleFileChange(eventType, filename) {
    if (this.isProcessing) {
      return; // 防止重复处理
    }
    
    this.isProcessing = true;
    
    try {
      console.log(`📝 检测到文件变化: ${eventType} - ${filename || 'unknown'}`);
      
      // 延迟处理，确保文件写入完成
      setTimeout(async () => {
        try {
          await this.processFileChange();
        } catch (error) {
          console.error('❌ 处理文件变化失败:', error);
          this.emit('processError', {
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } finally {
          this.isProcessing = false;
        }
      }, this.options.debounceDelay);
      
    } catch (error) {
      console.error('❌ 文件变化处理失败:', error);
      this.isProcessing = false;
    }
  }

  /**
   * 处理文件变化
   */
  async processFileChange() {
    if (!this.currentFile || !fs.existsSync(this.currentFile)) {
      console.log('❌ 文件已被删除，停止监控');
      await this.stopWatching();
      return;
    }
    
    // 检查文件是否真的发生了变化
    const hasChanged = await this.checkFileChanged(this.currentFile);
    if (!hasChanged) {
      console.log('📊 文件内容未变化，跳过处理');
      return;
    }
    
    // 更新文件状态
    await this.updateFileState(this.currentFile);
    
    // 发送文件更新事件
    this.emit('fileChanged', {
      filePath: this.currentFile,
      timestamp: new Date().toISOString(),
      fileInfo: await this.getFileInfo(this.currentFile)
    });
    
    console.log(`✅ 文件变化已处理: ${path.basename(this.currentFile)}`);
  }

  /**
   * 检查文件是否发生变化
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否发生变化
   */
  async checkFileChanged(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const currentModified = stats.mtime.getTime();
      
      // 检查修改时间
      if (this.lastModified && currentModified <= this.lastModified) {
        return false;
      }
      
      // 检查文件哈希（如果启用）
      if (this.options.enableHashCheck && this.lastHash) {
        const fileBuffer = fs.readFileSync(filePath);
        const currentHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
        
        if (currentHash === this.lastHash) {
          return false;
        }
        
        console.log(`📊 文件内容已变化: ${this.lastHash.substring(0, 8)}... -> ${currentHash.substring(0, 8)}...`);
      }
      
      return true;
    } catch (error) {
      console.error('❌ 检查文件变化失败:', error);
      return false;
    }
  }

  /**
   * 更新文件状态
   * @param {string} filePath - 文件路径
   */
  async updateFileState(filePath) {
    try {
      const stats = fs.statSync(filePath);
      this.lastModified = stats.mtime.getTime();
      
      if (this.options.enableHashCheck) {
        const fileBuffer = fs.readFileSync(filePath);
        this.lastHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
      }
    } catch (error) {
      console.error('❌ 更新文件状态失败:', error);
      throw error;
    }
  }

  /**
   * 手动检查文件（定期检查）
   * @param {string} filePath - 文件路径
   */
  async checkFileManually(filePath) {
    if (!this.currentFile || this.isProcessing) {
      return;
    }
    
    try {
      const hasChanged = await this.checkFileChanged(filePath);
      if (hasChanged) {
        console.log('📊 定期检查发现文件变化');
        await this.processFileChange();
      }
    } catch (error) {
      console.error('❌ 手动检查文件失败:', error);
    }
  }

  /**
   * 获取文件信息
   * @param {string} filePath - 文件路径
   * @returns {Object} 文件信息
   */
  async getFileInfo(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        lastModifiedFormatted: stats.mtime.toLocaleString()
      };
    } catch (error) {
      console.error('❌ 获取文件信息失败:', error);
      return null;
    }
  }

  /**
   * 启动状态报告
   */
  startStatusReport() {
    this.statusInterval = setInterval(() => {
      if (this.currentFile && fs.existsSync(this.currentFile)) {
        this.emit('statusReport', {
          filePath: this.currentFile,
          isWatching: !!this.fileWatcher,
          lastModified: this.lastModified,
          timestamp: new Date().toISOString()
        });
      }
    }, this.options.statusReportInterval);
  }

  /**
   * 处理监控器错误
   * @param {Error} error - 错误对象
   */
  handleWatcherError(error) {
    console.error('❌ 文件监控错误:', error);
    this.emit('watchError', {
      error: error.message,
      filePath: this.currentFile,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 处理监控器关闭
   */
  handleWatcherClose() {
    console.log('🔚 文件监控已关闭');
    this.emit('watchClosed', {
      filePath: this.currentFile,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 获取当前监控状态
   * @returns {Object} 监控状态
   */
  getStatus() {
    return {
      isWatching: !!this.fileWatcher,
      currentFile: this.currentFile,
      lastModified: this.lastModified,
      lastHash: this.lastHash ? this.lastHash.substring(0, 8) + '...' : null,
      isProcessing: this.isProcessing
    };
  }

  /**
   * 销毁监控器
   */
  async destroy() {
    await this.stopWatching();
    this.removeAllListeners();
  }
}

module.exports = FileMonitor;
