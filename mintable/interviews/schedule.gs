const DURATION_MS = 15 * 60 * 1000;

// Main function to create mixer 1-1 events with a random combination of people
function main() {
  let event_start = new Date('August 27, 2023 10:00:00')
  let event_end = new Date('August 27, 2023 18:00:00')

  let calId = getCalendarId('1-1s')
  let calender = CalendarApp.getCalendarById(calId);
  let events = calendar.getEvents(event_start, event_end);

  for (let st = event_start.getTime(); st < event_end.getTime(); event_start += DURATION_MS) {
    let et = st + DURATION_MS;
    let { p1, p2 } = pickTwoPeople(PEOPLE);
    let title = `1-1 (${n1} / ${n2})`

    // Step 1: Create automated event from st -> et
    let event = scheduleEvent(title, st, et);
    // Step 2: Add both participants as guests to said event
    addGuestsToCalendar(event, [
      { 'Email': p1, 'Name': name1 },
      { 'Email': p2, 'Name': name2 },
    ]);
  }
}


// People related functions
function pickTwoPeople(people, n) {
  let p1 = getRandomInt(n);
  let p2 = getRandomInt(n);

  // Odds of picking the same number is 1/n
  // Expected probability of while loop increases with more iterations
  while (p1 == p2) {
    p2 = getRandomInt(n);
  }

  return {
    'p1': people[p1],
    'p2': people[p2],
  };
}

function getName(email) {
  let username = email.split('.')[0];
  return `${username[0].charAt(0).toUpperCase()}${username.slice(1)}`;
}

// Helper functions
function getRandomInt(n) {
  return Math.floor(Math.random() * n);
}
