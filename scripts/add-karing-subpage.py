#!/usr/bin/env python3
"""Patch an exported Remnawave subscription page offline; input stays unchanged."""
import argparse
import copy
import json
from pathlib import Path

STORE = 'https://apps.apple.com/app/karing/id6472431552'
SCHEME = 'karing://install-config?url='

def patch_config(source):
    result = copy.deepcopy(source)
    platforms = result.get('platforms')
    if not isinstance(platforms, dict) or 'ios' not in platforms:
        raise ValueError('Нужен экспорт страницы Remnawave с platforms.ios')
    ios = platforms['ios']
    locales = result.get('locales', result.get('config', {}).get('additionalLocales', []))
    def text(ru, en):
        return {**{lang: en for lang in locales}, 'ru': ru, 'en': en}
    install = text('Установите Karing из App Store. Если импорт из Telegram не открывается, откройте эту страницу в Safari.', 'Install Karing from the App Store. Open this page in Safari if importing from Telegram does not work.')
    add = text('Нажмите «Добавить в Karing» и подтвердите импорт. Или скопируйте ссылку подписки и добавьте её через «+» в Karing. Импортируйте ссылку, а не файл, чтобы подписка обновлялась.', 'Tap Add to Karing and confirm, or copy your subscription URL and import it with + in Karing. Use a URL rather than a file so it can update.')
    connect = text('Обновите подписку, выберите локацию и включите VPN. При лимите устройств включите передачу X-HWID в настройках подписки Karing. Если обновление не работает, отправьте поддержке точный текст ошибки.', 'Refresh the subscription, choose a server and enable VPN. Enable X-HWID in the subscription settings if device limits are enabled. Send support the exact update error if it fails.')
    if isinstance(ios, dict) and isinstance(ios.get('apps'), list):
        app = {'name': 'Karing', 'featured': True, 'svgIconKey': 'AppleIcon', 'blocks': []}
        specs = [
            (text('Установить Karing', 'Install Karing'), install, [{'link': STORE, 'text': text('Скачать в App Store', 'Get on App Store'), 'type': 'external', 'svgIconKey': 'ExternalLink'}], 'DownloadIcon'),
            (text('Добавить подписку', 'Add subscription'), add, [
                {'link': SCHEME + '{{SUBSCRIPTION_LINK}}', 'text': text('Добавить в Karing', 'Add to Karing'), 'type': 'subscriptionLink', 'svgIconKey': 'Plus'},
                {'link': '{{SUBSCRIPTION_LINK}}', 'text': text('Скопировать ссылку', 'Copy subscription URL'), 'type': 'copyButton', 'svgIconKey': 'CloudDownload'}], 'CloudDownload'),
            (text('Подключиться и обновлять', 'Connect and update'), connect, [], 'Check')]
        for title, description, buttons, icon in specs:
            app['blocks'].append({'title': title, 'description': description, 'buttons': buttons, 'svgIconKey': icon, 'svgIconColor': 'cyan'})
        ios['apps'] = [app] + [a for a in ios['apps'] if str(a.get('name', '')).lower() != 'karing']
    elif isinstance(ios, list):
        app = {'id': 'karing', 'name': 'Karing', 'isFeatured': True, 'urlScheme': SCHEME,
               'installationStep': {'description': install, 'buttons': [{'buttonLink': STORE, 'buttonText': text('Скачать в App Store', 'Get on App Store')}]},
               'addSubscriptionStep': {'description': add}, 'connectAndUseStep': {'description': connect}}
        platforms['ios'] = [app] + [a for a in ios if str(a.get('id', '')).lower() != 'karing' and str(a.get('name', '')).lower() != 'karing']
    else:
        raise ValueError('Неизвестный формат platforms.ios. Исходный файл не изменён.')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        result = patch_config(json.loads(args.input.read_text(encoding='utf-8-sig')))
        with args.output.open('x', encoding='utf-8') as out:
            json.dump(result, out, ensure_ascii=False, indent=2)
            out.write('\n')
    except (ValueError, OSError) as exc:
        parser.exit(1, str(exc) + '\n')
    print('Готово. Проверьте новый JSON и импортируйте его в конфигурацию страницы подписки. Исходный файл сохранён.')
