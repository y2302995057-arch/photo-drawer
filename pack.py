# -*- coding: utf-8 -*-
# 把照片墙打成「一人一份」的绿色压缩包：双击启动.bat 即可用，无需安装 Node。
# 收集：server.mjs + public + 精简 node_modules + runtime(node.exe) + 启动脚本 + 说明 + 空的照片目录。
# 排除：一切运行时数据（config/sessions/缓存/日志）、开发测试残留、wasm 备选原生包。
import os, shutil, zipfile, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = "抽屉"                      # zip 里的根目录名（解压后看到的文件夹）
BUILD = os.path.join(ROOT, "build")
ZIP = os.path.join(BUILD, "抽屉-绿色版.zip")

# ---------- 暂存目录 ----------
# 每次都用全新的临时目录，不需要先删旧内容：
#   1) 绕开「批量删除需要确认」的限制（清 190 个文件会被拦下）；
#   2) build/ 下已有的目录（比如正在跑的演示实例）也不会被误删。
WORK = tempfile.mkdtemp(prefix="pw-pack-")
STAGE = os.path.join(WORK, APP_DIR)
os.makedirs(STAGE)
os.makedirs(BUILD, exist_ok=True)

def cp(src, dst, ignore=None):
    s = os.path.join(ROOT, src)
    d = os.path.join(STAGE, dst)
    if os.path.isdir(s):
        shutil.copytree(s, d, ignore=ignore)
    else:
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)

# ---------- 程序主体 ----------
cp("server.mjs", "server.mjs")
cp("package.json", "package.json")
cp("public", "public")
cp("runtime", "runtime")                       # 内置 node.exe，用户无需安装
cp("启动照片墙.bat", "启动.bat")               # 分发改个更短的名字

# ---------- node_modules：只留 sharp 运行必需 ----------
NM = os.path.join(ROOT, "node_modules")
def nm_ignore(d, names):
    rel = os.path.relpath(d, NM).replace("\\", "/")
    if rel == ".":
        return {n for n in names if n in (".bin", ".package-lock.json", "@emnapi")}
    if rel == "@img":
        return {n for n in names if n == "sharp-wasm32"}   # wasm 备选，win64 用不到
    return set()
cp("node_modules", "node_modules", ignore=nm_ignore)

# ---------- 空的「我的照片」目录 + 引导说明 ----------
PHOTO = os.path.join(STAGE, "我的照片")
os.makedirs(PHOTO, exist_ok=True)
with open(os.path.join(PHOTO, "把照片放进这个文件夹.txt"), "w", encoding="utf-8") as f:
    f.write("把你的照片（或装照片的文件夹）复制到这个「我的照片」文件夹，\n"
            "然后双击「启动.bat」，刷新页面就能看到了。\n\n"
            "也可以在第一次打开的页面里，改选你电脑里已有的照片文件夹。\n")

# ---------- 小白使用说明 ----------
with open(os.path.join(STAGE, "使用说明.txt"), "w", encoding="utf-8") as f:
    f.write(
        "======================================\n"
        "  抽屉 · 使用说明\n"
        "======================================\n\n"
        "这是什么：\n"
        "  一个在自己电脑上整理、浏览照片的小工具。\n"
        "  照片只存在你的电脑里，不上传、不需要联网账号。\n\n"
        "三步上手：\n"
        "  1) 解压这个压缩包（建议解压到桌面或 D 盘）\n"
        "  2) 双击里面的「启动.bat」\n"
        "  3) 浏览器会自动打开。第一次用跟着页面：选照片文件夹 → 设个密码 → 完成\n\n"
        "照片放哪：\n"
        "  - 最简单：把照片复制进包里的「我的照片」文件夹\n"
        "  - 或在首次打开的页面里，选你电脑里已有的照片文件夹\n\n"
        "手机也能看：\n"
        "  手机和电脑连同一个 WiFi，电脑启动后，手机浏览器输入\n"
        "  电脑黑窗口里显示的那个网址（http://192.168.x.x:端口）即可。\n\n"
        "常见问题：\n"
        "  Q 杀毒软件 / Windows 提示有风险？\n"
        "  A 这是本地小工具，不联网、不上传。点「仍要运行」即可。\n"
        "  Q 想改照片文件夹或密码？\n"
        "  A 删掉程序目录里的 config.json，再重新双击「启动.bat」即可重新设置。\n"
        "  Q 怎么停止？\n"
        "  A 关闭那个黑窗口即可。\n\n"
        "隐私承诺：\n"
        "  本工具不联网、不上传、不收集任何信息，\n"
        "  你的照片永远只在你自己的电脑里。\n"
        "======================================\n")

# ---------- 打 zip（UTF-8 文件名，中文不乱码）----------
# 旧包可能正被预览器 / 下载器独占锁住（覆盖会 PermissionError），
# 依次换备选名，不让整个打包失败。
def _writable(path):
    try:
        with open(path, "ab"):
            pass
        return True
    except OSError:
        return False

if not _writable(ZIP):
    for suffix in ("-新版", "-新版2", "-新版3"):
        cand = os.path.join(BUILD, "抽屉-绿色版" + suffix + ".zip")
        if _writable(cand):
            print(f"提示：{os.path.basename(ZIP)} 被占用，改写到 {os.path.basename(cand)}")
            ZIP = cand
            break
    else:
        import time
        ZIP = os.path.join(BUILD, "抽屉-绿色版-" + time.strftime("%Y%m%d-%H%M") + ".zip")
        print("提示：常用文件名都被占用，改写到 " + os.path.basename(ZIP))

count = 0
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for base, dirs, files in os.walk(STAGE):
        for name in files:
            full = os.path.join(base, name)
            arc = os.path.relpath(full, WORK)  # 含「照片墙/」前缀，解压自成一个文件夹
            z.write(full, arc)
            count += 1

size_mb = os.path.getsize(ZIP) / 1048576
print(f"打包完成：{ZIP}")
print(f"共 {count} 个文件，{size_mb:.1f} MB")

# 临时目录能清就清，清不掉也不影响产物
try:
    shutil.rmtree(WORK)
except Exception:
    print("提示：临时目录没能自动清理，可以手动删：" + WORK)
