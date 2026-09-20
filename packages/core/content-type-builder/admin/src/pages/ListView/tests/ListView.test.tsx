import { render, screen } from '@testing-library/react';

import ListView from '../ListView';

const mockUseDataManager = jest.fn();
const mockUseParams = jest.fn();

jest.mock('@strapi/admin/strapi-admin', () => ({
  Layouts: {
    Header: ({ title }: { title: string }) => <h1>{title}</h1>,
    Content: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  },
  tours: {
    contentTypeBuilder: {
      Introduction: ({ children }: React.PropsWithChildren) => <>{children}</>,
    },
  },
}));

jest.mock('@strapi/design-system', () => ({
  Box: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Button: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
  Flex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Typography: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

jest.mock('@strapi/icons', () => ({
  Information: () => null,
  Pencil: () => null,
  Plus: () => null,
}));

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage, id }: { defaultMessage?: string; id: string }) =>
      defaultMessage ?? id,
  }),
}));

jest.mock('react-router-dom', () => ({
  Navigate: () => null,
  useParams: () => mockUseParams(),
}));

jest.mock('styled-components', () => ({
  styled: (Component: React.ComponentType) => () => Component,
}));

jest.mock('../../../components/CTBSession/ctbSession', () => ({
  useCTBTracking: () => ({ trackUsage: jest.fn() }),
}));

jest.mock('../../../components/DataManager/useDataManager', () => ({
  useDataManager: () => mockUseDataManager(),
}));

jest.mock('../../../components/FormModalNavigation/useFormModalNavigation', () => ({
  useFormModalNavigation: () => ({
    onOpenModalAddComponentsToDZ: jest.fn(),
    onOpenModalAddField: jest.fn(),
    onOpenModalEditSchema: jest.fn(),
  }),
}));

jest.mock('../../../components/List', () => ({
  List: () => null,
}));

jest.mock('../LinkToCMSettingsView', () => ({
  LinkToCMSettingsView: () => null,
}));

describe('ListView', () => {
  it('preserves the component display name casing in the page title', () => {
    mockUseParams.mockReturnValue({ componentUid: 'default.a-comp' });
    mockUseDataManager.mockReturnValue({
      isInDevelopmentMode: false,
      isLoading: false,
      contentTypes: {},
      components: {
        'default.a-comp': {
          uid: 'default.a-comp',
          modelType: 'component',
          status: 'UNCHANGED',
          attributes: [],
          info: { displayName: 'aComp' },
        },
      },
    });

    render(<ListView />);

    expect(screen.getByRole('heading', { name: 'aComp' })).toBeInTheDocument();
  });

  it('keeps capitalizing content type titles', () => {
    mockUseParams.mockReturnValue({ contentTypeUid: 'api::article.article' });
    mockUseDataManager.mockReturnValue({
      isInDevelopmentMode: false,
      isLoading: false,
      components: {},
      contentTypes: {
        'api::article.article': {
          uid: 'api::article.article',
          modelType: 'contentType',
          kind: 'collectionType',
          visible: true,
          status: 'UNCHANGED',
          attributes: [],
          info: { displayName: 'article' },
        },
      },
    });

    render(<ListView />);

    expect(screen.getByRole('heading', { name: 'Article' })).toBeInTheDocument();
  });
});
