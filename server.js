const express = require('express');
const cors = require('cors');
const path = require('path');

// 设置控制台编码为 UTF-8
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

// 设置环境变量确保正确的编码
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.LANG = 'zh_CN.UTF-8';
process.env.LC_ALL = 'zh_CN.UTF-8';

// 在 Windows 上设置控制台编码
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

const app = express();
const PORT = 3000;

// 中间件配置
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log('🚀 Aseprite预览器服务器启动成功');
  console.log(`📡 服务器地址: http://localhost:${PORT}`);
  console.log('📁 静态文件服务已启用');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});
