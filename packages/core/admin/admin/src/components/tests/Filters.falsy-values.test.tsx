import { render, screen, waitFor } from '@tests/utils';

import { Filters } from '../Filters';

const renderFilters = (options: Filters.Filter[]) =>
  render(
    <Filters.Root options={options}>
      <Filters.Trigger />
      <Filters.Popover />
      <Filters.List />
    </Filters.Root>
  );

describe('Filters falsy values', () => {
  it('applies false as a boolean filter value', async () => {
    const { user } = renderFilters([
      {
        name: 'isActive',
        label: 'Active user',
        type: 'boolean',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Filters' }));

    const input = await screen.findByRole('checkbox', { name: 'Active user' });
    await user.click(input);
    await user.click(input);

    const addFilterButton = screen.getByRole('button', { name: 'Add filter' });
    expect(addFilterButton).toBeEnabled();
    await user.click(addFilterButton);

    await waitFor(() => {
      expect(screen.getByText('Active user $eq false')).toBeInTheDocument();
    });
  });

  it('applies zero as a numeric filter value', async () => {
    const { user } = renderFilters([
      {
        name: 'score',
        label: 'Score',
        type: 'integer',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Filters' }));

    const input = await screen.findByRole('spinbutton', { name: 'Score' });
    await user.type(input, '0');

    const addFilterButton = screen.getByRole('button', { name: 'Add filter' });
    expect(addFilterButton).toBeEnabled();
    await user.click(addFilterButton);

    await waitFor(() => {
      expect(screen.getByText('Score $eq 0')).toBeInTheDocument();
    });
  });
});
