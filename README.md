# Smart Queue System for Hospitals & Clinics

A full-stack web application for managing patient queues, appointments, and notifications in healthcare settings.

## Features

### Patient Side
- User registration and login
- Book online appointments with doctors
- Join live queue with token generation
- View real-time queue status and estimated waiting time
- Emergency patient priority handling
- Popup notifications for booking confirmation

### Doctor Side
- Secure login for doctors and staff
- View patient queue in real-time
- Call next patient and manage queue flow
- Mark appointments as completed
- See upcoming appointments

### Admin Side
- Manage doctors and their specialties
- View system statistics (total patients, appointments)
- Add/remove doctors from the system

## Technical Stack

- **Backend:** Node.js with Express
- **Database:** SQLite with sqlite3
- **Authentication:** JWT and sessions
- **Frontend:** HTML, CSS (Bootstrap), JavaScript
- **Real-time Updates:** Polling for queue status
- **AI/Heuristic:** Waiting time calculation based on queue position

## Installation

1. Clone the repository.
2. Install dependencies: `npm install`
3. Run the application: `npm start`

## Database Schema

- **users:** id, name, email, password_hash, role, phone
- **doctors:** id, user_id, specialty, schedule
- **appointments:** id, patient_id, doctor_id, date_time, status
- **queue:** id, patient_id, doctor_id, token, emergency, entered_at, position

## Sample Data

The application includes sample admin and doctor accounts:
- Admin: admin@example.com / admin
- Doctor: doctor@example.com / doctor

## Usage

1. Open `http://localhost:3000` in your browser.
2. Register as a patient, doctor, or admin.
3. Patients can book appointments or join queues.
4. Doctors can manage their queues and appointments.
5. Admins can oversee the system.

## API Endpoints

- POST /register: Register a new user
- POST /login: Login user
- POST /book-appointment: Book an appointment
- POST /join-queue: Join the queue
- GET /queue-status: Get patient's queue status
- GET /doctors: Get list of doctors
- GET /doctor-dashboard: Get doctor's dashboard data
- POST /call-next/:queueId: Call next patient
- POST /complete-appointment/:apptId: Complete appointment
- GET /admin-dashboard: Get admin dashboard data
- POST /add-doctor: Add a new doctor
- DELETE /remove-doctor/:doctorId: Remove a doctor

## UI Features

- Beautiful landing page with gradient background
- Fixed sidebar navigation on dashboard pages
- Responsive design with Bootstrap
- Cards for UI sections
- Hover effects and animations
- Modal popups for forms and confirmations
- Real-time updates via JavaScript polling

## Future Enhancements

- WebSocket for real-time updates
- Email/SMS notifications
- Mobile app
- Advanced analytics
- Multi-clinic support