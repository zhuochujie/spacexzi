#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步 core、server、web 的 USDT 地址，更新已有 .env 和 .env.example。"""

import argparse
import importlib.util
from pathlib import Path


# 与部署结果导出共用地址校验、env 注释和换行保留逻辑。
_spec = importlib.util.spec_from_file_location(
    'deployment_env', Path(__file__).with_name('export-deployment.py')
)
_deployment = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_deployment)


def update_usdt(token_address, *, root=None, dry_run=False):
    token_address = _deployment.address(token_address.strip())
    root = Path(root) if root is not None else Path(__file__).resolve().parents[2]
    projects = {
        'core': 'USDT_TOKEN_ADDRESS',
        'server': 'USDT_TOKEN_ADDRESS',
        'web': 'VITE_USDT_TOKEN_ADDRESS',
    }
    updates = {}
    # 先读取和校验所有文件，避免输入错误或符号链接导致部分配置先被修改。
    for project, key in projects.items():
        for filename in ('.env', '.env.example'):
            path = root / project / filename
            if path.is_symlink():
                raise ValueError(f'不允许更新符号链接：{path}')
            if not path.exists():
                continue
            text = path.read_bytes().decode('utf-8')
            updates[path] = _deployment.update_env_text(text, {key: token_address})
    if not updates:
        raise ValueError('未找到可更新的 .env 或 .env.example 文件')
    if not dry_run:
        for path, text in updates.items():
            path.write_bytes(text.encode('utf-8'))
    return list(updates)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='USDT 合约地址：非零的 0x 开头 40 位十六进制地址')
    parser.add_argument('--dry-run', action='store_true', help='只列出将更新的文件，不写入')
    args = parser.parse_args()
    try:
        paths = update_usdt(args.address, dry_run=args.dry_run)
    except (ValueError, OSError, UnicodeError) as error:
        parser.exit(1, f'更新失败：{error}\n')
    print('将更新以下文件：' if args.dry_run else '已更新以下文件：')
    for path in paths:
        print(path)
    if not args.dry_run:
        print('配置已更新；请重启后端，前端重新构建或重启开发服务。')


if __name__ == '__main__':
    main()
