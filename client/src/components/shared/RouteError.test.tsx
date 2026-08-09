import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { PageError, RouteError } from './RouteError';

/**
 * The components that only ever run once something else has already broken — which is
 * exactly when they cannot afford to be broken too. Nothing else in the suite renders
 * them, so this file is the only thing standing between a bad error screen and a user
 * who is already having a bad time.
 *
 * Two variants, and the difference is the point: `RouteError` is the whole-app fallback
 * for an error that escaped the shell, while `PageError` sits *inside* it, so one broken
 * screen leaves the nav alive and you can walk away from it. Every route carries its own
 * `PageError` for that reason (see `router.tsx`).
 */

/** React logs a caught error, and so does React Router. Neither is a test failure. */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('the screen blew up while rendering');
}

/** A route that throws on render, caught by the boundary under test. */
function renderThrowing(boundary: React.ReactElement) {
  const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: boundary }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

/** An address that matches nothing, which React Router turns into a 404 response. */
function renderNotFound(boundary: React.ReactElement) {
  const router = createMemoryRouter(
    [{ path: '/', element: <p>Dashboard</p>, errorElement: boundary }],
    { initialEntries: ['/nowhere'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('a screen that threw', () => {
  it('says what happened rather than showing a blank page', () => {
    renderThrowing(<RouteError />);

    expect(screen.getByText('This screen failed to load')).toBeInTheDocument();
  });

  /**
   * The reassurance that matters most here: an error on a *read* screen has not eaten
   * anything. Nothing in this app writes on load, so saying so is true and it is the
   * first question anyone has.
   */
  it('says the data is untouched, because nothing here writes on load', () => {
    renderThrowing(<RouteError />);

    expect(screen.getByText(/Your data is untouched/)).toBeInTheDocument();
  });

  it('says what to try next', () => {
    renderThrowing(<RouteError />);

    expect(screen.getByText(/Reloading usually clears it/)).toBeInTheDocument();
  });

  /** SPEC §10: state what happened and how to fix it; do not apologise. */
  it('does not apologise', () => {
    renderThrowing(<RouteError />);

    expect(screen.queryByText(/sorry|apolog|oops/i)).toBeNull();
  });

  it('always offers a way out', () => {
    renderThrowing(<RouteError />);

    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });
});

describe('an address that matches nothing', () => {
  /** A 404 is not a crash, and telling someone their working app is broken is worse copy. */
  it('is told apart from a crash', () => {
    renderNotFound(<RouteError />);

    expect(screen.getByText('That page does not exist')).toBeInTheDocument();
    expect(screen.queryByText('This screen failed to load')).toBeNull();
  });

  it('explains that the address is the problem', () => {
    renderNotFound(<RouteError />);

    expect(screen.getByText(/does not match any screen in this app/)).toBeInTheDocument();
    // The crash copy would be actively misleading here — nothing broke.
    expect(screen.queryByText(/Your data is untouched/)).toBeNull();
  });

  it('offers the dashboard as somewhere real to restart from', () => {
    renderNotFound(<RouteError />);

    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });
});

describe('the in-shell variant', () => {
  /**
   * The whole reason every route carries its own boundary: React Router walks up to the
   * *nearest* one, so a single boundary on the layout route would take the sidebar down
   * with the screen — leaving no way to navigate off the thing that just failed.
   */
  it('leaves the navigation standing so you can walk away from the broken screen', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <nav aria-label="Main">
                <Link to="/accounts">Accounts</Link>
              </nav>
              <Outlet />
            </div>
          ),
          children: [
            { index: true, element: <Boom />, errorElement: <PageError /> },
            { path: 'accounts', element: <p>Accounts screen</p> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);

    expect(screen.getByText('This screen failed to load')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('actually navigates away, rather than only appearing to offer it', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <nav aria-label="Main">
                <Link to="/accounts">Accounts</Link>
              </nav>
              <Outlet />
            </div>
          ),
          children: [
            { index: true, element: <Boom />, errorElement: <PageError /> },
            { path: 'accounts', element: <p>Accounts screen</p> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('link', { name: 'Accounts' }));

    expect(await screen.findByText('Accounts screen')).toBeInTheDocument();
    expect(screen.queryByText('This screen failed to load')).toBeNull();
  });

  /** A failure that replaces a screen has to announce itself; it is not decoration. */
  it('announces itself as an alert', () => {
    const { container } = render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <PageError /> }], {
          initialEntries: ['/'],
        })}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Not the full-page variant: no h1, because the shell around it already owns one.
    expect(container.querySelector('h1')).toBeNull();
  });

  it('offers a reload as well as a way out, since a reload usually is the fix', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location);

    renderThrowing(<PageError />);

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });

  it('tells a 404 apart just as the full-page variant does', () => {
    renderNotFound(<PageError />);

    expect(screen.getByText('That page does not exist')).toBeInTheDocument();
  });
});
