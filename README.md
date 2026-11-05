# 抽屉 · photo-drawer

自己电脑上的照片浏览工具。指一个文件夹就能用——不导入、不建库、不上传，也不动你的文件。

![首页](docs/screenshots/home.jpg)

---

## 起因

照片攒到几十万张、文件夹几千个之后，找东西就变成了一件很烦的事。

Windows 自带的照片应用打开大目录会卡死，Lightroom 那类工具又太重：它要"导入"，要建自己的库，还得再占一份空间。我只是想看看硬盘里原来那些文件夹而已。

所以自己写了一个。它不移动、不重命名、不生成数据库，你原来的目录结构长什么样，它就照着读。

## 现在能干的

首页是一张张系列卡片，一个文件夹一张。点「查看」进去看这个文件夹的照片；文件夹里还有子文件夹，就再下钻一层。

也可以切成瀑布流，直接把图铺开，滚到哪加载哪。

- **几十万张不卡**：目录只读一层，照片分页加载，缩略图有缓存
- **手机能看**：连同一个 WiFi，浏览器输个地址就行
- **有密码**：挡住别人，也挡住自己手滑
- **能换样子**：卡片三种质感、背景四种颜色，选完记在这台设备上

<p align="center">
  <img src="docs/screenshots/glass.jpg" width="300" alt="玻璃卡片">
  <img src="docs/screenshots/view.jpg" width="440" alt="看图页">
</p>

## 几个取舍

**不统计照片数量。** 一开始做了，但把几千个目录递归数一遍要三秒多，首屏一直白着等。后来整个删掉了——现在只显示"已加载 120 张"这种运行时才知道的数字。想要总数就得付那三秒，我觉得不值。

**缩略图先放内存。** 内存宽裕就只进内存，紧了才往 `.thumbcache/` 里写，两边都有硬上限，不会把机器吃满。

**目录树不递归读。** 点开哪个文件夹才读哪个，所以启动是一瞬间的事，跟你照片库多大没关系。

**首页不是瀑布流。** 照片一多，瀑布流反而更难找东西。所以默认按文件夹分卡片，想铺开再自己切。

## 跑起来

去 [Releases](../../releases) 下 `抽屉-绿色版.zip`，解压，双击 `启动.bat`。浏览器会自己打开，第一次跟着页面设个密码、选照片文件夹就完事了。包里带了 node.exe，不用装环境。

想自己改代码：

```bash
git clone https://github.com/y2302995057-arch/photo-drawer.git
cd photo-drawer
npm install          # 只有一个依赖：sharp
node server.mjs
```

默认开在 http://127.0.0.1:3210 ，监听 `0.0.0.0`，所以同一个 WiFi 下的手机直接用 `http://你的IP:3210` 也能打开。

```bash
node server.mjs "D:/照片"      # 临时指定别的文件夹，可以传多个
node server.mjs --no-open      # 不自动开浏览器
```

第一次启动会生成 `config.json`，密码存的是加盐哈希，不是明文。忘了密码就把这个文件删掉重启，重新设一遍。

| 字段 | 干嘛的 |
| --- | --- |
| `photoDir` / `photoDirs` | 照片文件夹，可以给多个 |
| `port` | 端口，被占了会自动往后找 |
| `appName` | 页面上显示的名字 |
| `passSalt` / `passHash` | 密码，删掉这两个就是重新设置 |

## 还没做的

- 启动脚本只有 Windows 的，Mac 和 Linux 得自己 `node server.mjs`
- 不支持视频，只认图片
- 搜索是按文件名找的，不认照片内容

有想法随时提 issue。我不一定马上做，但都会看。

## 借了谁的光

登录页那四个会跟着鼠标看的角色，造型和动作来自 [animatedlogin-react](https://github.com/Keduoli03/animatedlogin-react)（MIT）。原版是 React 写的，我用原生 DOM/CSS 重写了一遍，没把 React 拉进来。

路径分段和按钮的动效参考了 [React Bits](https://reactbits.dev)。

后端就是 Node 自带的 `http` 加 [sharp](https://sharp.pixelplumbing.com/)，没有别的框架。

## 许可

MIT。随便用，出事别找我。

---

更细的东西（路由表、缓存策略、测试脚本怎么跑）在 [README-dev.md](README-dev.md)。
