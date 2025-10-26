#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');

console.log('🚀 启动完整的 Aseprite 预览器应用...');

// 检查端口是否被占用
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.once('close', () => {
        resolve(true);
      });
      server.close();
    });
    
    server.on('error', () => {
      resolve(false);
    });
  });
}

// 清理端口占用
async function cleanupPort(port) {
  console.log(`🔍 检查端口 ${port} 状态...`);
  const isAvailable = await checkPortAvailable(port);
  
  if (!isAvailable) {
    console.log(`⚠️ 端口 ${port} 被占用，尝试清理...`);
    
    try {
      // 在 Windows 上查找并终止占用端口的进程
      const { exec } = require('child_process');
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (stdout) {
          const lines = stdout.split('\n');
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0') {
                console.log(`🔄 终止进程 PID: ${pid}`);
                exec(`taskkill /f /pid ${pid}`, (killError) => {
                  if (killError) {
                    console.warn(`无法终止进程 ${pid}:`, killError.message);
                  } else {
                    console.log(`✅ 已终止进程 ${pid}`);
                  }
                });
              }
            }
          });
        }
      });
      
      // 等待端口释放
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.warn('清理端口时出错:', error.message);
    }
  } else {
    console.log(`✅ 端口 ${port} 可用`);
  }
}

// 设置控制台编码
if (process.platform === 'win32') {
  try {
    require('child_process').exec('chcp 65001', (error) => {
      if (error) {
        console.warn('无法设置控制台编码:', error.message);
      }
    });
  } catch (error) {
    console.warn('设置控制台编码失败:', error.message);
  }
}

let serverProcess = null;
let electronProcess = null;
let logBuffer = []; // 日志缓冲区
let maxLogLines = 100; // 最大日志行数

// 添加日志到缓冲区
function addToLogBuffer(type, message) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] [${type}] ${message}`;
  
  logBuffer.push(logEntry);
  
  // 保持缓冲区大小
  if (logBuffer.length > maxLogLines) {
    logBuffer.shift();
  }
  
  return logEntry;
}

// 显示服务器状态
function showServerStatus() {
  console.log('\n📊 服务器状态监控:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (logBuffer.length > 0) {
    console.log('📝 最近的服务器日志:');
    logBuffer.slice(-10).forEach(log => console.log(log)); // 显示最近10条
  } else {
    console.log('⏳ 等待服务器日志...');
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// 检查服务器是否启动成功
function checkServerReady() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3000', (res) => {
      console.log('✅ Node 服务器已启动并响应');
      resolve(true);
    });
    
    req.on('error', (err) => {
      console.log('⏳ 等待服务器启动...');
      resolve(false);
    });
    
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 启动 Node 服务器
async function startServer() {
  console.log('📡 启动 Node 服务器...');
  
  // 先清理端口
  await cleanupPort(3000);
  
  serverProcess = spawn('node', ['server.js'], {
    stdio: ['inherit', 'pipe', 'pipe'], // 分离输出流
    shell: true,
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8'
    }
  });

  // 处理服务器输出
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      const logEntry = addToLogBuffer('服务器', output);
      console.log(logEntry);
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      const logEntry = addToLogBuffer('服务器错误', output);
      console.error(logEntry);
    }
  });

  serverProcess.on('error', (error) => {
    console.error('❌ 服务器启动失败:', error.message);
    if (error.code === 'EADDRINUSE') {
      console.error('💡 端口被占用，请手动清理后重试');
    }
  });

  serverProcess.on('exit', (code) => {
    console.log(`📡 服务器已退出，代码: ${code}`);
    if (code !== 0) {
      console.error('❌ 服务器异常退出');
    }
  });

  // 等待服务器启动
  let attempts = 0;
  const maxAttempts = 30; // 最多等待30秒
  
  while (attempts < maxAttempts) {
    const isReady = await checkServerReady();
    if (isReady) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  if (attempts >= maxAttempts) {
    console.error('❌ 服务器启动超时');
    process.exit(1);
  }
}

// 启动 Electron
function startElectron() {
  console.log('📱 启动 Electron 应用...');
  
  electronProcess = spawn('npx', ['electron', '.'], {
    stdio: ['inherit', 'pipe', 'pipe'], // 分离输出流
    shell: true,
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8'
    }
  });

  // 处理 Electron 输出（可选，通常不需要显示）
  electronProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('Request Autofill')) { // 过滤掉无用的日志
      console.log(`[Electron] ${output}`);
    }
  });

  electronProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('Request Autofill')) { // 过滤掉无用的错误
      console.error(`[Electron错误] ${output}`);
    }
  });

  electronProcess.on('error', (error) => {
    console.error('❌ Electron 启动失败:', error.message);
  });

  electronProcess.on('exit', (code) => {
    console.log(`📱 Electron 已退出，代码: ${code}`);
    // 当 Electron 退出时，也关闭服务器
    if (serverProcess && !serverProcess.killed) {
      console.log('正在关闭服务器...');
      serverProcess.kill();
    }
  });
}

// 优雅关闭
function cleanup() {
  console.log('\n🛑 正在关闭应用...');
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// 主启动流程
async function main() {
  try {
    await startServer();
    startElectron();
    
    // 启动定期状态显示
    setInterval(() => {
      if (serverProcess && !serverProcess.killed) {
        showServerStatus();
      }
    }, 30000); // 每30秒显示一次状态
    
  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }
}

main();
