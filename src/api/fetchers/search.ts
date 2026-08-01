// `groupSearch: [{id}]` is not a property of TripSearch / ExceptionEventSearch /
// DeviceSearch, and MyGeotab SILENTLY IGNORES unknown search properties — so
// picking a Group in the filter bar filtered nothing. Restricting by group goes
// through the nested deviceSearch instead.
//
// Confirm against the API Runner: run Get Trip with and without this filter on a
// group that is a strict subset of the fleet. Identical result counts would mean
// the property is still being ignored.
export function groupDeviceSearch(groupId?: string): object {
  return groupId ? { deviceSearch: { groups: [{ id: groupId }] } } : {};
}
