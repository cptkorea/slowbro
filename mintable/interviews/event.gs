function scheduleEvent(title, startTime, endTime) {
    let event_start = new Date(startTime);
    let event_end = new Date(endTime);

    let calendar = CalendarApp.getCalendarsByName('1-1s');

    if (calendar.length > 0) {
        console.log(`Scheduling event for ${calendar[0]}`);
        calendar[0].createEvent(title, event_start, event_end);
    } else {
        console.log('Unable to find calendar named 1-1');
    }
}

// Get CalendarId by name, picks the first available one
function getCalendarId(name) {
    let calendars = CalendarApp.getCalendarsByName('1-1s');
    return calendars[0]?.getId();
}

// Adds all guests to calendar event
// See: https://stackoverflow.com/questions/53992955/how-do-i-send-the-standard-invitation-email-when-calling-addguest-on-a-calendare
function addGuestsToCalendar(event, guests) {
    for (const guest of guests) {
        event.addGuest(guest['Email'])
    }
}