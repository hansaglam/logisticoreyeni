/**
 * Legal pages validation for logisticore-legal GitHub Pages site.
 * Run: npx tsx scripts/legal-pages-validation-test.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'logisticore-legal');
const SUPPORT_EMAIL = 'ethemsincarbusiness@gmail.com';
const DEVELOPER_NAME = 'Ethem Sincar';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function readLegal(relativePath: string): string {
  const full = join(ROOT, relativePath);
  if (!existsSync(full)) {
    throw new Error(`Missing file: ${relativePath}`);
  }
  return readFileSync(full, 'utf8');
}

function collectHtmlFiles(): string[] {
  return [
    'index.html',
    'privacy-policy/index.html',
    'privacy-choices/index.html',
    'account-deletion/index.html',
    'support/index.html',
  ];
}

function readAllLegalText(): string {
  const html = collectHtmlFiles().map(readLegal).join('\n');
  const readme = existsSync(join(ROOT, 'README.md'))
    ? readFileSync(join(ROOT, 'README.md'), 'utf8')
    : '';
  return `${html}\n${readme}`;
}

function extractHrefs(html: string): string[] {
  const matches = html.matchAll(/href=["']([^"']+)["']/gi);
  return [...matches].map((match) => match[1].trim());
}

function resolveInternalTarget(fromFile: string, href: string): string | null {
  if (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#') ||
    href.startsWith('javascript:')
  ) {
    return null;
  }
  if (href === '' || href === '#') {
    return '';
  }

  const fromDir = dirname(join(ROOT, fromFile));
  let target = normalize(join(fromDir, href));

  if (href.endsWith('/')) {
    target = join(target, 'index.html');
  } else if (!href.includes('.') && !href.endsWith('/')) {
    const asDir = join(target, 'index.html');
    if (existsSync(asDir)) {
      target = asDir;
    } else if (existsSync(`${target}.html`)) {
      target = `${target}.html`;
    }
  }

  return target;
}

console.log('\n=== Legal Pages Validation ===\n');

console.log('Structure');
{
  assert(existsSync(join(ROOT, '.nojekyll')), '.nojekyll present');
  assert(existsSync(join(ROOT, 'assets/styles.css')), 'assets/styles.css present');
  assert(!existsSync(join(ROOT, 'assets/site.js')), 'no unused site.js');
  for (const file of collectHtmlFiles()) {
    assert(existsSync(join(ROOT, file)), `${file} exists`);
  }
  const rootEntries = readdirSync(ROOT);
  assert(!rootEntries.includes('node_modules'), 'no node_modules in legal root');
}

console.log('\nLinks and viewport');
{
  for (const file of collectHtmlFiles()) {
    const html = readLegal(file);
    assert(html.includes('lang="en"'), `${file} lang=en`);
    assert(html.includes('charset="UTF-8"'), `${file} UTF-8 charset`);
    assert(html.includes('name="viewport"'), `${file} has mobile viewport`);
    assert(html.includes('<title>'), `${file} has title`);
    assert(html.includes('name="description"'), `${file} has meta description`);
    assert(!html.includes('localhost'), `${file} has no localhost URL`);
    assert(!/<script[\s>]/i.test(html), `${file} has no inline/external script tags`);
    assert(!html.includes('site.js'), `${file} has no site.js reference`);

    const hrefs = extractHrefs(html);
    for (const href of hrefs) {
      assert(href.length > 0, `${file} has no empty href`, href);
      const target = resolveInternalTarget(file, href);
      if (target === '') {
        assert(false, `${file} invalid empty internal href`);
        continue;
      }
      if (target != null) {
        assert(existsSync(target), `${file} link resolves: ${href}`, target);
      }
      if (href.startsWith('mailto:')) {
        assert(!href.includes('mailto:mailto:'), `${file} valid mailto format`);
      }
    }
  }
}

console.log('\nContent requirements');
{
  const privacy = readLegal('privacy-policy/index.html');
  const deletion = readLegal('account-deletion/index.html');
  const choices = readLegal('privacy-choices/index.html');
  const support = readLegal('support/index.html');
  const home = readLegal('index.html');
  const styles = readLegal('assets/styles.css');
  const all = readAllLegalText();

  assert(!all.includes('SUPPORT_EMAIL_REQUIRED'), 'no SUPPORT_EMAIL_REQUIRED placeholder');
  assert(all.includes(SUPPORT_EMAIL), 'support email present');
  assert(all.includes(DEVELOPER_NAME), 'developer name present');
  assert(/AdMob/i.test(privacy), 'privacy mentions AdMob');
  assert(/Firebase/i.test(privacy), 'privacy mentions Firebase');
  assert(/third-party|Third-Party/i.test(privacy), 'third-party services described');
  assert(/rewarded/i.test(privacy), 'privacy mentions rewarded ads');
  assert(/30 days/i.test(privacy) && /30 days/i.test(deletion), '30 days retention text present');
  assert(deletion.includes('Delete Account'), 'account deletion path documented');
  assert(deletion.includes('Dangerous Actions'), 'dangerous actions step documented');
  assert(
    deletion.includes('mailto:ethemsincarbusiness@gmail.com?subject=LogistiCore%20Account%20Deletion%20Request'),
    'deletion mailto subject correct',
  );
  assert(
    support.includes('mailto:ethemsincarbusiness@gmail.com?subject=LogistiCore%20Support%20Request'),
    'support mailto subject correct',
  );
  assert(choices.includes('Privacy Choices'), 'privacy choices page title');
  assert(/LogistiCore/i.test(home), 'app name on home page');
  assert(
    deletion.includes('Do not include') && deletion.includes('Password'),
    'deletion page does not request passwords/tokens',
  );
  assert(
    all.includes('com.ethemsincar.logisticore'),
    'package/bundle id documented',
  );
  assert(support.includes('href="../privacy-policy/"'), 'support links Privacy Policy');
  assert(support.includes('href="../privacy-choices/"'), 'support links Privacy Choices');
  assert(support.includes('href="../account-deletion/"'), 'support links Account Deletion');
  assert(deletion.includes('Firebase Authentication account'), 'deletion data list present');
  assert(deletion.includes('Open <strong>LogistiCore</strong>'), 'in-app deletion steps present');
}

console.log('\nContact UX (no large CTA buttons)');
{
  const deletion = readLegal('account-deletion/index.html');
  const support = readLegal('support/index.html');
  const styles = readLegal('assets/styles.css');

  assert(!deletion.includes('cta-button'), 'account deletion has no CTA button class');
  assert(!support.includes('cta-button'), 'support has no CTA button class');
  assert(!styles.includes('.cta-button'), 'styles.css has no .cta-button');
  assert(!deletion.includes('Request Account Deletion'), 'account deletion has no large CTA label');
  assert(!/<a[^>]*class="[^"]*cta-button/i.test(support), 'support has no CTA anchor');
  assert(deletion.includes('Request deletion by email'), 'deletion email request card title');
  assert(support.includes('Contact Support'), 'support contact card title');
  assert(deletion.includes('LogistiCore Account Deletion Request'), 'deletion subject visible as text');
  assert(support.includes('LogistiCore Support Request'), 'support subject visible as text');
  assert(
    (deletion.match(/ethemsincarbusiness@gmail\.com/g) ?? []).length >= 2,
    'deletion email visible independently of mailto-only UX',
  );
  assert(
    (support.match(/ethemsincarbusiness@gmail\.com/g) ?? []).length >= 2,
    'support email visible independently of mailto-only UX',
  );
  assert(deletion.includes('contact-card'), 'deletion uses contact-card');
  assert(support.includes('contact-card'), 'support uses contact-card');
  assert(deletion.includes('Include only'), 'deletion include-only section');
  assert(deletion.includes('Do not include'), 'deletion do-not-include section');
}

console.log('\nSecurity / tracking');
{
  const trackingPatterns = [
    /google-analytics/i,
    /googletagmanager/i,
    /gtag\s*\(/i,
    /facebook\.net/i,
    /hotjar/i,
    /segment\.com/i,
    /plausible\.io/i,
  ];
  for (const file of collectHtmlFiles()) {
    const html = readLegal(file);
    const hasTracker = trackingPatterns.some((pattern) => pattern.test(html));
    assert(!hasTracker, `${file} has no tracking scripts`);
  }
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  console.log('\nValidation incomplete — fix failures before publishing.\n');
  process.exit(1);
}
console.log('✅ ALL PASS\n');
