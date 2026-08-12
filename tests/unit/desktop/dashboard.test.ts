import { describe, expect, it } from 'vitest';
import { dashboardHtml } from '../../../src/desktop/dashboard';

describe('desktop dashboard HTML', () => {
  it('ships syntactically valid browser JavaScript', () => {
    const html = dashboardHtml('test-token');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('escapes tokens before embedding them in the page', () => {
    const html = dashboardHtml('</script><script>alert(1)</script>');

    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('\\u003c/script>');
  });
});
