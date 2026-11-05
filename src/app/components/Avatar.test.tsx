import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveAvatar, SLOTS } from '../lib/avatar';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('draws every pose with every other part', () => {
    const base = resolveAvatar(null, 'u1');
    for (const pose of SLOTS[0].parts) {
      for (const { slot, parts } of SLOTS) {
        for (const part of parts) {
          const html = renderToStaticMarkup(<Avatar choice={{ ...base, pose: pose.key, [slot]: part.key }} />);
          expect(html, `${pose.key} ${slot}.${part.key}`).toContain('<path');
          expect(html, `${pose.key} ${slot}.${part.key}`).not.toMatch(/undefined|NaN/);
        }
      }
    }
  });

  it('never writes a stored value into the markup', () => {
    const html = renderToStaticMarkup(<Avatar choice={resolveAvatar({ hat: '"><script>x</script>' }, 'u')} />);
    expect(html).not.toContain('script');
    // Even a choice that skipped resolveAvatar draws nothing from it.
    const raw = { ...resolveAvatar(null, 'u'), hat: '"><script>x</script>', body: '"><script>x</script>' };
    expect(renderToStaticMarkup(<Avatar choice={raw} />)).not.toContain('script');
  });

  it('paints the Background color', () => {
    const html = renderToStaticMarkup(<Avatar choice={{ ...resolveAvatar(null, 'u'), background: 'lilac' }} />);
    expect(html).toContain('fill="#c5b4f5"');
  });

  it('paints a solid frisbee only in poses holding one', () => {
    const choice = { ...resolveAvatar(null, 'u'), frisbee: 'purple', topColor: 'gold', bottomColor: 'gold', body: 'gold', background: 'gold' };
    expect(renderToStaticMarkup(<Avatar choice={{ ...choice, pose: 'forehand' }} />)).toContain('#7a5fd0');
    expect(renderToStaticMarkup(<Avatar choice={{ ...choice, pose: 'cheer' }} />)).not.toContain('#7a5fd0');
  });

  it('is hidden from screen readers', () => {
    expect(renderToStaticMarkup(<Avatar choice={resolveAvatar(null, 'u')} />)).toContain('aria-hidden="true"');
  });
});
