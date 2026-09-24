import { Form } from '@strapi/admin/strapi-admin';
import { render as renderRTL } from '@tests/utils';

import { Wysiwyg } from '../Field';

document.createRange = () => {
  const range = new Range();
  range.getBoundingClientRect = jest.fn();
  // @ts-expect-error – mocking.
  range.getClientRects = jest.fn(() => ({
    item: () => null,
    length: 0,
  }));

  return range;
};

window.focus = jest.fn();

const render = () =>
  renderRTL(<Wysiwyg type="richtext" name="rich-text" label="Markdown" disabled={false} />, {
    renderOptions: {
      wrapper: ({ children }) => (
        <Form method="POST" onSubmit={jest.fn()}>
          {children}
        </Form>
      ),
    },
  });

describe('Wysiwyg expand mode', () => {
  it('refreshes CodeMirror geometry when the expanded editor is resized', async () => {
    const originalResizeObserver = window.ResizeObserver;
    const instances: Array<{
      observedTargets: Element[];
      disconnect: jest.Mock;
    }> = [];

    const ResizeObserverMock = jest.fn().mockImplementation(() => {
      const instance = {
        observedTargets: [] as Element[],
        observe: jest.fn((target: Element) => {
          instance.observedTargets.push(target);
        }),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
        takeRecords: jest.fn(() => []),
      };

      instances.push(instance);
      return instance;
    });

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });

    try {
      const { user, getByRole, unmount } = render();

      expect(
        instances.some((instance) =>
          instance.observedTargets.some((target) => target.classList.contains('CodeMirror'))
        )
      ).toBe(false);

      await user.click(getByRole('button', { name: 'Expand' }));

      const editorObserver = instances.find((instance) =>
        instance.observedTargets.some((target) => target.classList.contains('CodeMirror'))
      );

      expect(editorObserver).toBeDefined();

      unmount();

      expect(editorObserver?.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    }
  });
});
