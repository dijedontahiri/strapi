import { render as renderRTL, screen, waitFor } from '@tests/utils';
import { Route, Routes } from 'react-router-dom';

import { ComponentProvider } from '../../ComponentContext';
import { RelationsInput } from '../Relations';

const UNKNOWN_RELATION_ERROR =
  "You've tried to add a relation with an id that does not exist in the options you can see";

describe('Relations create option', () => {
  it('does not treat creatable text as a relation id inside a dynamic-zone component', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { user } = renderRTL(
        <ComponentProvider level={0} uid="shared.quote" type="dynamiczone">
          <RelationsInput
            attribute={{
              type: 'relation',
              relation: 'manyToMany',
              target: 'api::category.category',
              inversedBy: 'quotes',
              // @ts-expect-error – this is what the API returns
              targetModel: 'api::category.category',
              relationType: 'manyToMany',
            }}
            label="Related category"
            mainField={{ name: 'name', type: 'string' }}
            name="blocks.0.relatedCategory"
            type="relation"
          />
        </ComponentProvider>,
        {
          renderOptions: {
            wrapper: ({ children }) => (
              <Routes>
                <Route path="/content-manager/:collectionType/:slug/:id" element={children} />
              </Routes>
            ),
          },
          initialEntries: ['/content-manager/collection-types/api::article.article/create'],
        }
      );

      const combobox = await screen.findByRole('combobox', { name: /Related category/ });
      await user.click(combobox);
      await user.type(combobox, 'Brand new category');

      const createOption = await screen.findByRole('option', { name: 'Create a relation' });
      expect(createOption).not.toHaveAttribute('aria-disabled', 'true');

      await user.click(createOption);

      await waitFor(() => {
        expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(UNKNOWN_RELATION_ERROR));
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
