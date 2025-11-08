from __future__ import print_function
import os
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Scope for full access to Google Calendar events
SCOPES = ['https://www.googleapis.com/auth/calendar']

def get_calendar_service():
    """
    Authenticate the user and return a Google Calendar API service instance.
    This function handles token storage and refresh automatically.
    """
    creds = None
    token_path = 'token.json'
    credentials_path = 'credentials.json'

    # Load saved user credentials if available
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # If no valid credentials are available, perform login flow
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                raise FileNotFoundError("Missing credentials.json for Google Calendar API authentication.")
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save credentials for next time
        with open(token_path, 'w') as token_file:
            token_file.write(creds.to_json())

    # Build the Calendar API service
    service = build('calendar', 'v3', credentials=creds)
    return service

