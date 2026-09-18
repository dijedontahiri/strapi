#!/usr/bin/env bash
set -euo pipefail

TEST_FILE='packages/core/content-manager/admin/src/pages/EditView/components/FormInputs/Relations/tests/Relations.test.tsx'
SOURCE_FILE='packages/core/content-manager/admin/src/pages/EditView/components/FormInputs/Relations/Relations.tsx'

python <<'PY'
from pathlib import Path
p = Path('packages/core/content-manager/admin/src/pages/EditView/components/FormInputs/Relations/tests/Relations.test.tsx')
s = p.read_text()
marker = "  it('should search nested component relations using the component id', async () => {"
test = r'''  it('does not treat create-on-the-fly search text as a relation id', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.get<{ model: string; fieldName: string }>(
        '/content-manager/relations/:model/:fieldName',
        () =>
          HttpResponse.json({
            results: [],
            pagination: { page: 1, pageCount: 1, pageSize: 10, total: 0 },
          })
      )
    );

    const { user } = renderRTL(
      <ComponentProvider id={undefined} level={1} uid="page-blocks.product-carousel" type="component">
        <RelationsInput
          attribute={{
            type: 'relation',
            relation: 'manyToMany',
            target: 'api::category.category',
            inversedBy: 'relation_locales',
            // @ts-expect-error – this is what the API returns
            targetModel: 'api::category.category',
            relationType: 'manyToMany',
          }}
          label="collection"
          mainField={{ name: 'name', type: 'string' }}
          model="page-blocks.product-carousel"
          name="content.0.products"
          type="relation"
          isRelatedToCurrentDocument
          onChange={jest.fn()}
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
        initialEntries: ['/content-manager/single-types/api::shop.shop'],
      }
    );

    const combobox = await screen.findByRole('combobox', { name: /collection/ });
    await user.click(combobox);
    await user.type(combobox, 'Brand new product');
    await user.click(await screen.findByRole('option', { name: 'Create a relation' }));

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('id that does not exist in the options you can see')
    );

    consoleError.mockRestore();
  });

'''
if marker not in s:
    raise SystemExit('test insertion marker missing')
p.write_text(s.replace(marker, test + marker, 1))
PY

set +e
yarn workspace @strapi/content-manager test:front --runInBand --runTestsByPath "$TEST_FILE" > /tmp/27246-before.log 2>&1
status=$?
set -e
cat /tmp/27246-before.log
if [ "$status" -eq 0 ]; then
  echo 'Regression unexpectedly passed against upstream; refusing speculative fix.' >&2
  exit 1
fi
grep -q 'does not treat create-on-the-fly search text as a relation id' /tmp/27246-before.log

git restore -- "$TEST_FILE"

python <<'PY'
from pathlib import Path
p = Path('packages/core/content-manager/admin/src/pages/EditView/components/FormInputs/Relations/Relations.tsx')
s = p.read_text()
old = '''      if (!relation) {
        // This is very unlikely to happen, but it ensures we don't have any data for.
        console.error(
          "You've tried to add a relation with an id that does not exist in the options you can see, this is likely a bug with Strapi. Please open an issue."
        );

        toggleNotification({
          message: formatMessage({
            id: getTranslation('relation.error-adding-relation'),
            defaultMessage: 'An error occurred while trying to add the relation.',
          }),
          type: 'danger',
        });

        return;
      }
'''
new = '''      if (!relation) {
        // A visible creatable combobox can emit its free-text value when focus moves to the
        // create action. Only values backed by the current relation results are selectable.
        return;
      }
'''
if old not in s:
    raise SystemExit('source replacement marker missing')
p.write_text(s.replace(old, new, 1))
PY

python <<'PY'
from pathlib import Path
p = Path('packages/core/content-manager/admin/src/pages/EditView/components/FormInputs/Relations/tests/Relations.test.tsx')
s = p.read_text()
marker = "  it('should search nested component relations using the component id', async () => {"
test = r'''  it('does not treat create-on-the-fly search text as a relation id', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.get<{ model: string; fieldName: string }>(
        '/content-manager/relations/:model/:fieldName',
        () =>
          HttpResponse.json({
            results: [],
            pagination: { page: 1, pageCount: 1, pageSize: 10, total: 0 },
          })
      )
    );

    const { user } = renderRTL(
      <ComponentProvider id={undefined} level={1} uid="page-blocks.product-carousel" type="component">
        <RelationsInput
          attribute={{
            type: 'relation',
            relation: 'manyToMany',
            target: 'api::category.category',
            inversedBy: 'relation_locales',
            // @ts-expect-error – this is what the API returns
            targetModel: 'api::category.category',
            relationType: 'manyToMany',
          }}
          label="collection"
          mainField={{ name: 'name', type: 'string' }}
          model="page-blocks.product-carousel"
          name="content.0.products"
          type="relation"
          isRelatedToCurrentDocument
          onChange={jest.fn()}
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
        initialEntries: ['/content-manager/single-types/api::shop.shop'],
      }
    );

    const combobox = await screen.findByRole('combobox', { name: /collection/ });
    await user.click(combobox);
    await user.type(combobox, 'Brand new product');
    await user.click(await screen.findByRole('option', { name: 'Create a relation' }));

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('id that does not exist in the options you can see')
    );

    consoleError.mockRestore();
  });

'''
if marker not in s:
    raise SystemExit('test insertion marker missing')
p.write_text(s.replace(marker, test + marker, 1))
PY

yarn workspace @strapi/content-manager test:front --runInBand --runTestsByPath "$TEST_FILE"
yarn workspace @strapi/content-manager test:front --runInBand
yarn workspace @strapi/content-manager test:ts:front
yarn workspace @strapi/content-manager lint
yarn prettier --check "$SOURCE_FILE" "$TEST_FILE"
git diff --check
git diff --stat
