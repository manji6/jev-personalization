"""Six synthetic-history probes. No SDK installation; never logs credentials."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.title = ''
        self.in_title = False
        self.jsonld_count = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('property', attrs.get('name'))] = attrs.get('content')
        if tag == 'title':
            self.in_title = True
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.jsonld_count += 1

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def prepare():
    pages = {}
    evidence = []
    for source in sorted((ROOT / 'sources').glob('*.html')):
        parser = Metadata()
        data = source.read_bytes()
        parser.feed(data.decode())
        key = source.stem
        assert parser.jsonld_count == 0, 'Review structured data before using fallback'
        page = {
            'name': parser.meta.get('og:title') or parser.title,
            'description': parser.meta.get('og:description') or parser.meta.get('description'),
        }
        assert page['name'] and page['description']
        pages[key] = page
        path = '/ja/' if key == 'ja' else '/ja/commerce/' + ('campaign/' if key == 'running-beginner' else 'detail/') + key + '/'
        evidence.append({'url': 'https://adobe.customer-experience.dev' + path,
                         'source_file': str(source.relative_to(ROOT)),
                         'sha256': hashlib.sha256(data).hexdigest(),
                         'jsonld_count_in_fetched_html': parser.jsonld_count,
                         'name_source': 'og:title', 'description_source': 'og:description',
                         'page': page})
    (ROOT / 'page-metadata.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    questions = {
        'commute_running_interest': {'type': 'noul', 'instructions': '閲覧履歴には、通勤ランに関心があることを示す行動がありますか？'},
        'beginner_information_interest': {'type': 'noul', 'instructions': '閲覧履歴には、ランニング初心者向けの情報に関心があることを示す行動がありますか？'},
    }
    definitions = [
        ('positive', [('running-beginner', 60), ('commute-running-shoes', 45), ('running-beginner', 30), ('commute-running-shoes', 20)], '両問yes寄り'),
        ('out_of_scope', [('stretch-suit-jacket', 60), ('quick-dry-polo', 45)], '両問no寄り'),
        ('insufficient', [('ja', 2)], '特定テーマの根拠不足'),
        ('brief_boundary', [('commute-running-shoes', 2)], '短時間だけでは関心の根拠が弱い'),
        ('product_only', [('commute-running-shoes', 60)], '通勤ランと初心者向け関心を区別できるか'),
        ('mixed_interest', [('commuter-briefcase', 60), ('commute-running-shoes', 20), ('commuter-briefcase', 45)], '通勤全般と通勤ランへの関心の境界'),
    ]
    cases = []
    for name, visits, expectation in definitions:
        history = [{'page': pages[key], 'visible_seconds': seconds} for key, seconds in visits]
        cases.append({'case': name, 'review_expectation': expectation,
                      'provenance': 'Page metadata is fetched; order and visible seconds are synthetic. No real visitor.',
                      'synthetic_delivery_state': {'already_shown': False, 'dismissed': False},
                      'request': {'model': 'jev-latest', 'state': {'current_page': history[-1]['page'], 'browsing_history_oldest_first': history}, 'questions': questions}})
    (ROOT / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2))
    return cases


def classify(probability):
    return 'yes' if probability > .7 else 'no' if probability < .3 else 'unsettled'


def run(cases):
    destination = ROOT / 'results.jsonl'
    if destination.exists():
        raise SystemExit('Results already exist; refusing to repeat billable requests')
    for case in cases:
        request = urllib.request.Request('https://api.typesafe.ai/v1/systemone',
            data=json.dumps(case['request'], ensure_ascii=False).encode(),
            headers={'Authorization': 'Bearer ' + os.environ['JEV_API_KEY'], 'Content-Type': 'application/json'})
        record = {'case': case['case'], 'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'method': 'POST', 'url': request.full_url, 'request': case['request']}
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                record['http_status'] = response.status
                raw = response.read().decode()
            record['response_raw'] = raw
            payload = json.loads(raw)
            record['returned_model'] = payload.get('model')
            record['usage'] = payload.get('usage')
            record['probabilities'] = {key: value['noul'] for key, value in payload['answers'].items()}
            labels = {key: classify(value) for key, value in record['probabilities'].items()}
            record['judgments'] = labels
            # Two separate marketing policies, both composed in code.
            record['broad_campaign_eligible'] = labels['commute_running_interest'] == 'yes'
            record['beginner_focused_eligible'] = all(value == 'yes' for value in labels.values())
        except urllib.error.HTTPError as error:
            record.update(http_status=error.code, error_body=error.read().decode(), decision='api_error')
        except Exception as error:
            record.update(error=type(error).__name__ + ': ' + str(error), decision='api_error')
        record['latency_ms'] = round((time.perf_counter() - start) * 1000, 2)
        with destination.open('a') as output:
            output.write(json.dumps(record, ensure_ascii=False) + '\n')
        print(json.dumps({key: value for key, value in record.items() if key not in ('request', 'response_raw')}, ensure_ascii=False), flush=True)
        if record.get('http_status') != 200:
            break


if __name__ == '__main__':
    import sys
    cases = prepare()
    if '--run' in sys.argv:
        run(cases)
