#Auto Statement  

###Description
This project access your email constantly, reading emails for pdf attachments, decrypt the pdf and save to dropbox. For eg. Email received on 23-03-2019 would be saved as '23-03-2019.pdf' in a folder named as '2019'.

###Getting Started
1. Run the following commands in project root directory:  
    ```npm install```  
    ```sudo apt-get update```  
    ```sudo apt-get install qpdf```  
    ```mv src/config/config_template.js src/config/config.js```  
2. Replace values in config.js with correct credentials  
3. Run the following command to start:  
    ```npm run start```
    
###Change settings
1. To use different mail server, edit the following code in src/app.js  
```
        const imap = new Imap({
            user: config.email,
            password: config.emailPassword,
            host: 'imap-mail.outlook.com',
            port: 993,
            tls: true,
            markSeen: true,
            markRead: true,
            authTimeout: 60000,
            connTimeout: 60000
        });
```   
2. To read emails based on different filter, edit the following code in src/app.js. Read documentation of [node-imap](https://github.com/mscdex/node-imap) to setup your filter  
    ```['UNSEEN', ['FROM', 'm2u@bills.maybank2u.com.my']]```   
3. To change where in dropbox the pdf will be stored, edit the following code in src/app.js  
    ```path: '/statement_ppc/' + year + '/' + newFilename```
    
###Notes
1. If imap connection throws error about authentication, make sure you have allow less secured app / third party app to access your mail account in your respective mail service provider portal
2. pm2 command:
```pm2 --name "autostatement" start npm -- run start```
