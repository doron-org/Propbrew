import { expect, test, type Page } from '@playwright/test';
import { openDialog, selectTab } from './dialog';

const workspaces = [
  { module: 'estate', name: 'Estate', entry: '/sign-up' },
  { module: 'facility', name: 'Facility', entry: '/login' },
  { module: 'shortlet', name: 'Shortlet', entry: '/sign-up' },
  { module: 'construction', name: 'Construction', entry: '/login' },
] as const;

async function assertDemoChoices(page: Page) {
  await expect(page.getByRole('heading', { name: 'Explore a demo', exact: true })).toBeVisible();
  const chooser = page.getByRole('form', { name: 'Demo workspaces', exact: true });
  await expect(chooser).toBeVisible();
  for (const workspace of workspaces) await expect(chooser.getByRole('button', { name: new RegExp(`Explore demo:.*${workspace.name}`) })).toBeVisible();
  await expect(page.getByText('Add, edit and try workflows with sample data. Your changes stay in your own sandbox. No sign-up required.', { exact: true })).toBeVisible();
}

async function exerciseShortletAccommodation(page: Page) {
  const suffix = Date.now().toString(36);
  const propertyName = `Sandbox Court ${suffix}`;
  const updatedPropertyName = `Sandbox Court Updated ${suffix}`;
  const apartmentName = `Sandbox Studio ${suffix}`;
  const guestName = `Sandbox Booking Guest ${suffix}`;
  await page.goto('/shortlet/properties');
  const property = page.getByRole('dialog', { name: 'Add property', exact: true });
  await openDialog(page.getByRole('button', { name: 'Add property', exact: true }), property);
  await property.getByLabel('Property name', { exact: true }).fill(propertyName);
  await property.getByLabel('City', { exact: true }).fill('Abuja');
  await property.getByLabel('Area / neighbourhood', { exact: true }).fill('Maitama');
  await property.getByRole('button', { name: 'Add property', exact: true }).click();
  await expect(property).toHaveCount(0);
  await expect(page.getByRole('heading', { name: propertyName, exact: true })).toBeVisible();
  const apartment = page.getByRole('dialog', { name: 'Add apartment', exact: true });
  await openDialog(page.getByRole('button', { name: `Add apartment to ${propertyName}`, exact: true }), apartment);
  await apartment.getByLabel('Apartment name', { exact: true }).fill(apartmentName);
  await apartment.getByLabel('Apartment type', { exact: true }).fill('Studio');
  await apartment.getByLabel('Nightly rate (₦)', { exact: true }).fill('10000.50');
  await apartment.getByRole('button', { name: 'Add apartment', exact: true }).click();
  await expect(apartment).toHaveCount(0);
  await expect(page.getByRole('heading', { name: apartmentName, exact: true })).toBeVisible();
  await page.reload();
  const apartmentEdit = page.getByRole('dialog', { name: 'Edit apartment', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit ${apartmentName} apartment`, exact: true }), apartmentEdit);
  await apartmentEdit.getByLabel('Nightly rate (₦)', { exact: true }).fill('12500.25');
  await apartmentEdit.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(apartmentEdit).toHaveCount(0);
  await expect(page.getByRole('region', { name: `${apartmentName} apartment details`, exact: true })).toContainText('₦12,500.25');
  const propertyEdit = page.getByRole('dialog', { name: 'Edit property', exact: true });
  await openDialog(page.getByRole('button', { name: `Edit ${propertyName} property`, exact: true }), propertyEdit);
  await propertyEdit.getByLabel('Property name', { exact: true }).fill(updatedPropertyName);
  await propertyEdit.getByRole('button', { name: 'Save property', exact: true }).click();
  await expect(propertyEdit).toHaveCount(0);
  await expect(page.getByRole('heading', { name: updatedPropertyName, exact: true })).toBeVisible();

  await page.goto('/shortlet/bookings');
  const booking = page.getByRole('dialog', { name: 'Create a booking', exact: true });
  await openDialog(page.getByRole('button', { name: 'New booking', exact: true }), booking);
  await booking.getByLabel('Guest name *', { exact: true }).fill(guestName);
  await booking.getByLabel('Apartment *', { exact: true }).selectOption({ label: `${apartmentName} · ${updatedPropertyName} · ₦12,500.25/night` });
  await booking.getByLabel('Check-in *', { exact: true }).fill('2028-02-01');
  await booking.getByLabel('Check-out *', { exact: true }).fill('2028-02-04');
  await booking.getByRole('checkbox', { name: 'I have reviewed these details and approve this record change.', exact: true }).check();
  await booking.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  await expect(booking).toHaveCount(0);
  await expect(page.getByText(guestName, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(guestName, { exact: true })).toBeVisible();
}

for (const workspace of workspaces) {
  test(`public ${workspace.name} demo opens an editable private sandbox and exits cleanly`, async ({ page }) => {
    await page.goto(workspace.entry);
    await assertDemoChoices(page);
    await page.getByRole('button', { name: new RegExp(`Explore demo:.*${workspace.name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/${workspace.module}$`));
    await expect(page.getByRole('navigation', { name: `${workspace.name} navigation`, exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Demo account notice', exact: true })).toHaveCount(0);

    if (workspace.module === 'estate') {
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      await expect(page.getByText('You’re all caught up.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      await page.getByRole('button', { name: 'Messages', exact: true }).click();
      await expect(page.getByText('No conversations yet.', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Messages', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add property', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeEnabled();
      await page.goto('/properties');
      await expect(page.getByRole('table', { name: 'Property list', exact: true })).toContainText('Lekki Gardens Estate');
    } else if (workspace.module === 'facility') {
      // Sensor cards live under their own tab; the overview default does not list them.
      await selectTab(page.getByRole('tab', { name: /^Sensor readings(?: \d+)?$/ }), page.getByRole('tabpanel', { name: /^Sensor readings(?: \d+)?$/ }));
      await expect(page.getByRole('heading', { name: 'Diesel tank — Block C', exact: true })).toBeVisible();
      await selectTab(page.getByRole('tab', { name: /^Alarms(?: \d+)?$/ }), page.getByRole('tabpanel', { name: /^Alarms(?: \d+)?$/ }));
      // The overview activity feed repeats the latest alarm, so scope to the alarms panel.
      await expect(page.getByRole('tabpanel', { name: /^Alarms(?: \d+)?$/ }).getByText('Coolant temperature high — sustained overheating', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create work order', exact: true }).first()).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Acknowledge', exact: true }).first()).toBeEnabled();
    } else if (workspace.module === 'shortlet') {
      await selectTab(page.getByRole('tab', { name: 'Availability', exact: true }), page.getByRole('tabpanel', { name: 'Availability', exact: true }));
      await expect(page.getByRole('region', { name: 'Next seven nights apartment occupancy calendar', exact: true })).toContainText('Marina Suites');
      await page.goto('/shortlet/bookings');
      await expect(page.getByText('SL-4200 · Unit 1A · Marina Suites', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New booking', exact: true })).toBeEnabled();
      await exerciseShortletAccommodation(page);
    } else {
      await page.goto('/construction/projects');
      await expect(page.getByRole('heading', { name: 'Marina Heights', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
    }

    const accountMenu = page.getByRole('button', { name: /^Account menu — / });
    await accountMenu.click();
    const menuId = await accountMenu.getAttribute('aria-controls');
    expect(menuId).toBeTruthy();
    await page.locator(`#${menuId}`).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await assertDemoChoices(page);
    await page.goto(`/${workspace.module}`);
    await expect(page).toHaveURL(/\/login$/);
  });
}
