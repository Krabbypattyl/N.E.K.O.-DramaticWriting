#!/usr/bin/env python3
"""N.E.K.O.-DramaticWriting Web 服务器启动脚本。"""
import os
import sys

def check_dependencies():
    """检查当前小剧场服务的直接运行依赖。"""
    try:
        import flask
        import flask_cors
        print("✓ Flask 依赖检查通过")
        return True
    except ImportError as e:
        print(f"✗ 缺少依赖: {e}")
        print("请运行: pip install -r requirements.txt")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("              N.E.K.O.-DramaticWriting Web 服务器")
    print("=" * 60)
    
    # 检查依赖
    if not check_dependencies():
        sys.exit(1)
    
    # Numeric v2 工作台直接使用浏览器原生模块，不依赖额外构建步骤。
    required_files = [
        'theater_generator/api.py',
        'theater_generator/numeric_v2.py',
        'theater_generator/numeric_v2_branch.py',
        'theater_generator/generation/numeric_v2.py',
        'frontend/theater/index.html',
        'frontend/theater/src/branch-wizard.js',
        'frontend/theater/src/main.js',
        'config.py',
    ]
    for file in required_files:
        if not os.path.exists(file):
            print(f"✗ 缺少必要文件: {file}")
            sys.exit(1)
    
    print("✓ 所有必要文件检查通过")
    
    # 启动服务器
    print("\n正在启动 Web 服务器...")
    print("作者工作台: http://localhost:5000")
    print("Numeric v2 API: http://localhost:5000/api/theater/numeric-v2")
    print("按 Ctrl+C 停止服务器")
    print("=" * 60)
    
    try:
        # 当前启动器只暴露小剧场剧本生成器。
        from theater_generator.api import create_app
        app = create_app()
        app.run(debug=True, host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        print("\n\n服务器已停止")
    except Exception as e:
        print(f"\n✗ 启动失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
