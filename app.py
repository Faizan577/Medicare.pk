from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash
from models import db, User, Doctor, Appointment, Queue
from config import Config
from datetime import datetime, timedelta
import smtplib
from email.mime.text import MIMEText
import os
import json

app = Flask(__name__)
app.config.from_object(Config)

db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Notification function (email simulation)
def send_notification(email, message):
    if app.config['MAIL_USERNAME']:
        msg = MIMEText(message)
        msg['Subject'] = 'Queue Notification'
        msg['From'] = app.config['MAIL_USERNAME']
        msg['To'] = email

        server = smtplib.SMTP(app.config['MAIL_SERVER'], app.config['MAIL_PORT'])
        server.starttls()
        server.login(app.config['MAIL_USERNAME'], app.config['MAIL_PASSWORD'])
        server.sendmail(app.config['MAIL_USERNAME'], email, msg.as_string())
        server.quit()
    else:
        print(f"Notification to {email}: {message}")  # Simulate

# Heuristic for waiting time: average 10 min per patient
def calculate_waiting_time(queue_length, position):
    avg_time = 10  # minutes
    return position * avg_time

@app.route('/')
def index():
    if current_user.is_authenticated:
        if current_user.role == 'patient':
            return redirect(url_for('patient_dashboard'))
        elif current_user.role == 'doctor':
            return redirect(url_for('doctor_dashboard'))
        elif current_user.role == 'admin':
            return redirect(url_for('admin_dashboard'))
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name = request.form['name']
        email = request.form['email']
        password = request.form['password']
        role = request.form['role']
        phone = request.form.get('phone')

        if User.query.filter_by(email=email).first():
            flash('Email already registered')
            return redirect(url_for('register'))

        user = User(name=name, email=email, role=role, phone=phone)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        if role == 'doctor':
            doctor = Doctor(user_id=user.id, specialty=request.form.get('specialty'), schedule='{}')
            db.session.add(doctor)
            db.session.commit()

        flash('Registration successful')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Invalid credentials')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/patient/dashboard')
@login_required
def patient_dashboard():
    if current_user.role != 'patient':
        return redirect(url_for('index'))
    doctors = Doctor.query.all()
    appointments = Appointment.query.filter_by(patient_id=current_user.id).all()
    queue_entry = Queue.query.filter_by(patient_id=current_user.id).first()
    return render_template('patient_dashboard.html', doctors=doctors, appointments=appointments, queue_entry=queue_entry)

@app.route('/book_appointment', methods=['POST'])
@login_required
def book_appointment():
    doctor_id = request.form['doctor_id']
    date_time_str = request.form['date_time']
    date_time = datetime.fromisoformat(date_time_str)
    appointment = Appointment(patient_id=current_user.id, doctor_id=doctor_id, date_time=date_time)
    db.session.add(appointment)
    db.session.commit()
    flash('Appointment booked')
    return redirect(url_for('patient_dashboard'))

@app.route('/join_queue', methods=['POST'])
@login_required
def join_queue():
    doctor_id = request.form['doctor_id']
    emergency = 'emergency' in request.form
    token = f"T{Queue.query.count() + 1:03d}"
    queue_entry = Queue(patient_id=current_user.id, doctor_id=doctor_id, token=token, emergency=emergency)
    db.session.add(queue_entry)
    db.session.commit()
    # Update positions
    update_queue_positions(doctor_id)
    flash('Joined queue')
    return redirect(url_for('patient_dashboard'))

def update_queue_positions(doctor_id):
    queues = Queue.query.filter_by(doctor_id=doctor_id).order_by(Queue.emergency.desc(), Queue.entered_at).all()
    for i, q in enumerate(queues):
        q.position = i + 1
    db.session.commit()

@app.route('/api/queue_status')
@login_required
def queue_status():
    if current_user.role != 'patient':
        return jsonify({'error': 'Unauthorized'}), 403
    queue_entry = Queue.query.filter_by(patient_id=current_user.id).first()
    if queue_entry:
        waiting_time = calculate_waiting_time(queue_entry.position - 1, queue_entry.position)
        return jsonify({
            'position': queue_entry.position,
            'waiting_time': waiting_time,
            'token': queue_entry.token
        })
    return jsonify({'position': None})

@app.route('/doctor/dashboard')
@login_required
def doctor_dashboard():
    if current_user.role != 'doctor':
        return redirect(url_for('index'))
    doctor = Doctor.query.filter_by(user_id=current_user.id).first()
    if not doctor:
        flash('Doctor profile not found')
        return redirect(url_for('index'))
    queues = Queue.query.filter_by(doctor_id=doctor.id).order_by(Queue.position).all()
    appointments = Appointment.query.filter_by(doctor_id=doctor.id, status='scheduled').all()
    return render_template('doctor_dashboard.html', queues=queues, appointments=appointments)

@app.route('/call_next/<int:queue_id>')
@login_required
def call_next(queue_id):
    queue_entry = Queue.query.get(queue_id)
    if queue_entry and queue_entry.doctor_rel.user_id == current_user.id:
        patient_email = queue_entry.patient.email
        send_notification(patient_email, f"Your turn! Token: {queue_entry.token}")
        db.session.delete(queue_entry)
        db.session.commit()
        update_queue_positions(queue_entry.doctor_id)
    return redirect(url_for('doctor_dashboard'))

@app.route('/complete_appointment/<int:appt_id>')
@login_required
def complete_appointment(appt_id):
    appointment = Appointment.query.get(appt_id)
    if appointment and appointment.doctor_rel.user_id == current_user.id:
        appointment.status = 'completed'
        db.session.commit()
    return redirect(url_for('doctor_dashboard'))

@app.route('/admin/dashboard')
@login_required
def admin_dashboard():
    if current_user.role != 'admin':
        return redirect(url_for('index'))
    doctors = Doctor.query.all()
    users = User.query.all()
    # Simple stats
    total_patients = User.query.filter_by(role='patient').count()
    total_appointments = Appointment.query.count()
    return render_template('admin_dashboard.html', doctors=doctors, users=users, total_patients=total_patients, total_appointments=total_appointments)

@app.route('/add_doctor', methods=['POST'])
@login_required
def add_doctor():
    if current_user.role != 'admin':
        return redirect(url_for('index'))
    name = request.form['name']
    email = request.form['email']
    specialty = request.form['specialty']
    user = User(name=name, email=email, role='doctor')
    user.set_password('defaultpass')  # Should change
    db.session.add(user)
    db.session.commit()
    doctor = Doctor(user_id=user.id, specialty=specialty, schedule='{}')
    db.session.add(doctor)
    db.session.commit()
    flash('Doctor added')
    return redirect(url_for('admin_dashboard'))

@app.route('/remove_doctor/<int:doctor_id>')
@login_required
def remove_doctor(doctor_id):
    if current_user.role != 'admin':
        return redirect(url_for('index'))
    doctor = Doctor.query.get(doctor_id)
    if doctor:
        db.session.delete(doctor)
        db.session.delete(doctor.user)
        db.session.commit()
    return redirect(url_for('admin_dashboard'))

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Sample data
        if not User.query.filter_by(email='admin@example.com').first():
            admin = User(name='Admin', email='admin@example.com', role='admin')
            admin.set_password('admin')
            db.session.add(admin)
            db.session.commit()
        if not User.query.filter_by(email='doctor@example.com').first():
            doc_user = User(name='Dr. Smith', email='doctor@example.com', role='doctor')
            doc_user.set_password('doctor')
            db.session.add(doc_user)
            db.session.commit()
            doctor = Doctor(user_id=doc_user.id, specialty='General', schedule='{}')
            db.session.add(doctor)
            db.session.commit()
    app.run(debug=True)