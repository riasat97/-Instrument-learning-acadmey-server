const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId, CURSOR_FLAGS } = require('mongodb');
require('dotenv').config()
const app = express();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;

// express middleware
app.use(cors());
app.use(express.json());

//Mongo Connection URL
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g8xlopp.mongodb.net/?retryWrites=true&w=majority`;

// Creating a MongoClient with a MongoClientOptions object
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Json Web Token Implimentation
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    const token = authorization.split(' ')[1];
    //generate access token secret using node command: first write node then in command: require('crypto').randomBytes(64).toString('hex')
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {

        //await client.connect();
        // All Collections
        const usersCollection = client.db("ilaDb").collection("users");
        const classesCollection = client.db("ilaDb").collection("classes");
        const studentClassesCollection = client.db("ilaDb").collection("student_classes");
        const paymentCollection = client.db("ilaDb").collection("payments");

        // jwt token generation
        app.post('/jwt', (req, res) => {
            const user = req.body;
            //console.log(user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            //console.log(token);
            res.send({ token });
        })
        // middlewares
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        const verifyStudent = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'student') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }

        // user apis
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });
        //get all users 
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        //check role-> admin/instructor
        app.get('/users/has-role/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const role = req.query?.role;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { role: user?.role === role }
            res.send(result);
        })
        app.get('/users/check-role/:email', async (req, res) => {
            const email = req.params.email;
            const role = req.query?.role;

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { role: user?.role === role }
            res.send(result);
        })
        // set role by admin
        app.patch('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const role = req.query?.role;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: role ? role : 'student'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);

        })
        app.delete('/users/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const result = await classesCollection.deleteOne(query);
            res.send(result);
        });

        // class related apis
        app.get('/classes', async (req, res) => {
            let query = {};
            if (req.query?.status) {
                query = { status: req.query.status };
            }
            const result = await classesCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const newClasses = req.body;
            const result = await classesCollection.insertOne(newClasses)
            res.send(result);
        })
        app.patch('/classes/:classId', verifyJWT, verifyInstructor, async (req, res) => {
            const classId = req.params.classId;
            const filter = { _id: new ObjectId(classId) };
            const { className, classImage, price, availableSeats, status } = req.body;
            const updateDoc = {
                $set: {
                    className: className,
                    classImage: classImage,
                    price: price,
                    availableSeats: availableSeats,
                    status: status ? status : 'pending'
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc)
            res.send(result);
        })
        //post class status by admin
        app.patch('/classes/:classId/statuses/:status', verifyJWT, verifyAdmin, async (req, res) => {
            const classId = req.params.classId;
            const status = req.params.status;

            const filter = { _id: new ObjectId(classId) };
            const updateDoc = {
                $set: {
                    status: status ? status : 'pending'
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        //post class feedback by admin
        app.patch('/classes/:classId/feedback', verifyJWT, verifyAdmin, async (req, res) => {
            const classId = req.params.classId;
            const newFeedBack = req.body;
            //res.send(feedback);   
            const filter = { _id: new ObjectId(classId) };
            const updateDoc = {
                $set: {
                    feedback: newFeedBack.feedback
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.get('/classes/:classId', async (req, res) => {
            const classId = req.params.classId;
            const query = { _id: new ObjectId(classId) };
            const result = await classesCollection.findOne(query);
            res.send(result);
        })

        app.delete('/classes/:id', verifyJWT, verifyInstructor, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await classesCollection.deleteOne(query);
            res.send(result);
        });

        //student classes apis

        app.post('/student-classes', verifyJWT, verifyStudent, async (req, res) => {
            const bookedClasses = req.body;
            const exists = await studentClassesCollection.findOne(bookedClasses);
            if (exists) return res.send({ exists: true })
            const result = await studentClassesCollection.insertOne(bookedClasses)
            res.send(result);
        });
        // student's selected classes
        app.get('/students/:studentId/classes', async (req, res) => {
            const studentId = req.params.studentId;
            const enrolledStatus = req.query?.enrolled;
            const enrolled = enrolledStatus === "true";
            const studentClasses = await studentClassesCollection.find({ studentId: studentId, enrolled: enrolled }).toArray();
            // Extract the classIds
            const classIds = studentClasses.map((studentClass) => new ObjectId(studentClass.classId));

            // Find the classes matching the classIds
            const matchedClasses = await classesCollection
                .find({ _id: { $in: classIds } })
                .toArray();

            // Combine student classes with matched classes
            const combinedClasses = matchedClasses.map((matchedClass) => {
                const studentClass = studentClasses.filter((sClass) => new ObjectId(sClass.classId).toString() === new ObjectId(matchedClass._id).toString());
                //console.log(studentClass);
                return {
                    ...matchedClass, studentClass
                };
            });

            res.json(combinedClasses);
        });
        //student payment history    
        app.get('/students/:email/payments', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const options = {
                sort: { _id: -1 },
            };
            const result = await paymentCollection.find(query, options).toArray();
            res.send(result);
        });

        app.delete('/students/:studentId/classes/:classId', verifyJWT, verifyStudent, async (req, res) => {
            const classId = req.params.classId;
            const studentId = req.params.studentId;
            const query = { studentId, classId }
            const result = await studentClassesCollection.deleteOne(query);
            res.send(result);
        });

        app.get('/students/:studentId/test', async (req, res) => {
            try {
                const studentId = req.params.studentId;
                const classes = await studentClassesCollection.aggregate([
                    {
                        $match: {
                            studentId: studentId
                        }
                    },
                    {
                        $lookup: {
                            from: 'classes',
                            localField: "classId",
                            foreignField: "_id",
                            as: "class"
                        }
                    },
                    {
                        $unwind: "$class"
                    },
                    {
                        $project: {
                            "class.className": 1,
                            "class.classImage": 1,
                            "class.price": 1,
                            "class.availableSeats": 1,
                            "class.instructorName": 1,
                            "class.instructorEmail": 1,
                        }
                    }
                ]).toArray();

                res.json(classes);
            } catch (error) {
                console.error('Error retrieving classes:', error);
                res.status(500).json({ error: 'An error occurred while retrieving classes.' });
            }
        });

        //instructor classes with enrollment count
        app.get('/instructors/:email/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const instructorEmail = req.params.email;

            try {
                // Find classes by instructor's email
                const classes = await classesCollection.find({ instructorEmail }).toArray();
                // Get classIds for lookup
                const classIds = classes.map((classItem) => classItem._id.toString());
                // Retrieve total enrolled students for each class
                const enrollments = await studentClassesCollection.aggregate([
                    {
                        $match: {
                            classId: { $in: classIds },
                        },
                    },
                    {
                        $group: {
                            _id: '$classId',
                            totalEnrollment: { $sum: 1 },
                        },
                    },
                ]).toArray();

                const classesWithEnrollment = classes.map((classItem) => {
                    const enrollment = enrollments.find((enrollment) => new ObjectId(enrollment._id).toString() === classItem._id.toString());
                    return {
                        ...classItem,
                        totalEnrollment: enrollment ? enrollment.totalEnrollment : 0,
                    };
                });

                res.json(classesWithEnrollment);
            } catch (error) {
                console.error('Error retrieving classes:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // payment related api
        // create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })
        // post payment
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const { classId, studentId } = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const filter = { _id: new ObjectId(classId) };
            const updateDoc = { $inc: { availableSeats: -1 } };
            const result = await classesCollection.updateOne(filter, updateDoc);

            const query = { classId, studentId };
            const updateEnrollment = {
                $set: {
                    enrolled: true
                },
            };
            const updateStudentClasses = await studentClassesCollection.updateOne(query, updateEnrollment);
            res.send({ insertResult, updateStudentClasses });
        });

        //public apis
        // all instructors/ top instructors        
        app.get('/instructors', async (req, res) => {
            try {
                const instructors = await usersCollection.find({ role: 'instructor' }).toArray();

                const pipeline = [
                    { $match: { instructorEmail: { $in: instructors.map(instructor => instructor.email) }, status: 'approved' } },
                    {
                        $group: {
                            _id: '$instructorEmail',
                            numberOfClasses: { $sum: 1 },
                            classesTaken: { $addToSet: '$className' },
                        },
                    },
                ];

                // Execute the aggregation pipeline
                const instructorDetails = await classesCollection.aggregate(pipeline).toArray();

                // Merge the instructor details with the original instructors array
                const instructorsWithDetails = instructors.map(instructor => {
                    const details = instructorDetails.find(details => details._id === instructor.email) || {};
                    return {
                        photoURL: instructor.photoURL,
                        name: instructor.name,
                        email: instructor.email,
                        numberOfClasses: details.numberOfClasses || 0,
                        classesTaken: details.classesTaken || [],
                    };
                });
                // Send the response with the instructor details
                const topInstructors = instructorsWithDetails.sort((a, b) => b.numberOfClasses - a.numberOfClasses);
                res.json(topInstructors);
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        // popular classes api
        app.get('/top-classes', async (req, res) => {
            try {
                // Retrieve approved classes
                const approvedClasses = await classesCollection.find({ status: 'approved' }).toArray();
                // Get the class IDs of approved classes
                const classIds = approvedClasses.map((cls) => cls._id.toString());

                // Retrieve enrolled students count for each class
                const enrolledStudentsCount = await studentClassesCollection.aggregate([
                    { $match: { classId: { $in: classIds }, enrolled: true } },
                    { $group: { _id: '$classId', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 6 }
                ]).toArray();
                console.log(enrolledStudentsCount);

                // Get the top 6 classes based on enrolled students count
                const topClasses = approvedClasses.map(classItem => {
                    const details = enrolledStudentsCount.find(details => details._id === classItem._id.toString()) || {};
                    return {
                        classId: classItem._id,
                        classImage: classItem.classImage,
                        className: classItem.className,
                        instructorName: classItem.instructorName,
                        instructorEmail: classItem.instructorEmail,
                        price: classItem.price,
                        availableSeats: classItem.availableSeats,
                        status: classItem.status,
                        numberOfStudents: details.count || 0,
                    };
                });
                const topClassesSorted = topClasses.sort((a, b) => b.numberOfStudents - a.numberOfStudents);
                res.json(topClassesSorted);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: 'An error occurred' });
            }
        });

        app.get('/app-stats', async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const classes = await classesCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0)

            res.send({
                revenue,
                users,
                classes,
                orders
            })
        })
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ILA is running')
})

app.listen(port, () => {
    console.log(`ILA is running on port ${port}`)
})